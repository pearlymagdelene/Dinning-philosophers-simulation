(() => {
    const countInput = document.getElementById('philosopher-count');
    const table = document.getElementById('table');
    const philosophersLayer = document.getElementById('philosophers');
    const chopsticksLayer = document.getElementById('chopsticks');
    const status = document.getElementById('game-status');
    const message = document.getElementById('game-message');
    const selectedLabel = document.getElementById('selected-label');
    const selectedState = document.getElementById('selected-state');
    const scoreDisplay = document.getElementById('score');
    const timeDisplay = document.getElementById('time-left');
    const fedDisplay = document.getElementById('fed-count');
    const conflictDisplay = document.getElementById('conflict-count');
    const freeDisplay = document.getElementById('free-count');
    const deadlockIndicator = document.getElementById('deadlock-indicator');
    const roster = document.getElementById('roster');
    const resultPanel = document.getElementById('result-panel');
    const intervalMs = 500;

    let philosophers = [];
    let chopsticks = [];
    let timer = null;
    let running = false;
    let gameOver = false;
    let deadlocked = false;
    let deadlockOccurred = false;
    let selectedId = 0;
    let score = 0;
    let elapsedSeconds = 0;
    let conflicts = 0;
    let fedCount = 0;
    let survivalTicks = 0;

    function createPhilosopher(id, count) {
        return {
            id,
            left: (id + count - 1) % count,
            right: id,
            state: 'Thinking',
            health: 100,
            held: [],
            waitingFor: null,
            fed: false
        };
    }

    function selectedPhilosopher() {
        return philosophers[selectedId];
    }

    function stopTimer() {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        running = false;
    }

    function setStatus(text, state) {
        status.textContent = text;
        status.dataset.state = state;
    }

    function setMessage(text, type = 'normal') {
        message.textContent = text;
        message.dataset.type = type;
    }

    function buildTable() {
        stopTimer();
        gameOver = false;
        deadlocked = false;
        deadlockOccurred = false;
        selectedId = 0;
        score = 0;
        elapsedSeconds = 0;
        conflicts = 0;
        fedCount = 0;
        survivalTicks = 0;

        const count = Math.max(2, Math.min(10, Number(countInput.value) || 5));
        countInput.value = count;
        table.dataset.count = count;
        philosophers = Array.from({ length: count }, (_, id) => createPhilosopher(id, count));
        chopsticks = Array(count).fill(null);
        philosophersLayer.replaceChildren();
        chopsticksLayer.replaceChildren();

        philosophers.forEach(philosopher => {
            const angle = (2 * Math.PI * philosopher.id) / count - Math.PI / 2;
            const seat = document.createElement('button');
            seat.type = 'button';
            seat.className = 'philosopher';
            seat.id = `philosopher-${philosopher.id}`;
            seat.innerHTML = `<strong>P${philosopher.id + 1}</strong><span class="state-label">Thinking</span><span class="seat-detail">Ready to work</span><span class="seat-health" role="progressbar" aria-label="P${philosopher.id + 1} health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span class="seat-health-fill"></span></span>`;
            seat.style.left = `${50 + Math.cos(angle) * 37}%`;
            seat.style.top = `${50 + Math.sin(angle) * 36}%`;
            seat.addEventListener('click', () => selectPhilosopher(philosopher.id));
            philosophersLayer.append(seat);

            const stickAngle = angle + Math.PI / count;
            const stick = document.createElement('div');
            stick.className = 'chopstick';
            stick.id = `chopstick-${philosopher.id}`;
            stick.innerHTML = `<span>C${philosopher.id + 1} FREE</span>`;
            stick.dataset.homeLeft = `${50 + Math.cos(stickAngle) * 25}`;
            stick.dataset.homeTop = `${50 + Math.sin(stickAngle) * 25}`;
            stick.style.left = `${stick.dataset.homeLeft}%`;
            stick.style.top = `${stick.dataset.homeTop}%`;
            stick.style.setProperty('--angle', `${stickAngle * 180 / Math.PI + 90}deg`);
            chopsticksLayer.append(stick);
        });

        document.getElementById('center-note').textContent = `${count} seats · clockwise from P1`;
        resultPanel.hidden = true;
        setStatus('READY', 'ready');
        setMessage('Start the game, select a philosopher, and choose their resources.');
        document.getElementById('start-button').textContent = 'Start Game';
        render();
    }

    function selectPhilosopher(id) {
        if (!philosophers[id]) return;
        selectedId = id;
        const philosopher = selectedPhilosopher();
        if (!gameOver && philosopher.held.length > 0) {
            const finishedMeal = philosopher.state === 'Eating';
            releaseResources(philosopher);
            philosopher.state = 'Thinking';
            if (finishedMeal) {
                score += 100;
                if (!philosopher.fed) {
                    philosopher.fed = true;
                    fedCount += 1;
                }
                setMessage(`P${philosopher.id + 1} finished eating and released both chopsticks. +100 points.`);
            } else {
                setMessage(`P${philosopher.id + 1} released their held chopstick.`);
            }
            render();
            updateDeadlock();
            return;
        }
        if (running && !gameOver && !deadlocked && philosopher.state === 'Thinking') {
            philosopher.state = 'Hungry';
        }
        if (running && !gameOver && !deadlocked && philosopher.state !== 'Eating') {
            takeBothChopsticks();
            return;
        }
        render();
    }

    function penalizeConflict(text) {
        conflicts += 1;
        score -= 10;
        setMessage(`${text} Conflict penalty: -10 points.`, 'warning');
        render();
    }

    function makeHungry() {
        const philosopher = selectedPhilosopher();
        if (!running || gameOver || deadlocked) return;
        if (philosopher.state !== 'Thinking') {
            penalizeConflict(`P${philosopher.id + 1} is already ${philosopher.state.toLowerCase()}.`);
            return;
        }
        philosopher.state = 'Hungry';
        setMessage(`P${philosopher.id + 1} is hungry. Choose one of their neighboring chopsticks.`);
        render();
    }

    function acquireChopstick(hand) {
        const philosopher = selectedPhilosopher();
        if (!running || gameOver || deadlocked) return;
        if (philosopher.state === 'Thinking' || philosopher.state === 'Eating') {
            penalizeConflict(`P${philosopher.id + 1} cannot request a chopstick while ${philosopher.state.toLowerCase()}.`);
            return;
        }

        const stick = hand === 'left' ? philosopher.left : philosopher.right;
        if (philosopher.held.includes(stick)) {
            penalizeConflict(`P${philosopher.id + 1} already holds C${stick + 1}.`);
            return;
        }

        const owner = chopsticks[stick];
        if (owner !== null && owner !== philosopher.id) {
            philosopher.state = 'Waiting';
            philosopher.waitingFor = stick;
            penalizeConflict(`C${stick + 1} is assigned to P${owner + 1}; P${philosopher.id + 1} must wait.`);
            updateDeadlock();
            return;
        }

        chopsticks[stick] = philosopher.id;
        philosopher.held.push(stick);
        if (philosopher.held.length === 2) {
            beginEating(philosopher);
        } else {
            philosopher.waitingFor = philosopher.left === stick ? philosopher.right : philosopher.left;
            philosopher.state = 'Waiting';
            setMessage(`P${philosopher.id + 1} holds C${stick + 1} and waits for C${philosopher.waitingFor + 1}.`);
        }
        render();
        updateDeadlock();
    }

    function takeLeftChopstick() {
        acquireChopstick('left');
    }

    function takeRightChopstick() {
        acquireChopstick('right');
    }

    function takeBothChopsticks() {
        const philosopher = selectedPhilosopher();
        if (!running || gameOver || deadlocked) return;
        if (philosopher.state === 'Thinking' || philosopher.state === 'Eating') {
            penalizeConflict(`P${philosopher.id + 1} must be hungry before requesting both neighboring chopsticks.`);
            return;
        }

        const neighbors = [philosopher.left, philosopher.right];
        const blockedStick = neighbors.find(stick => chopsticks[stick] !== null && chopsticks[stick] !== philosopher.id);
        if (blockedStick !== undefined) {
            philosopher.state = 'Waiting';
            philosopher.waitingFor = blockedStick;
            penalizeConflict(`C${blockedStick + 1} is assigned to P${chopsticks[blockedStick] + 1}; P${philosopher.id + 1} cannot take both.`);
            updateDeadlock();
            return;
        }

        neighbors.forEach(stick => {
            if (chopsticks[stick] === null) {
                chopsticks[stick] = philosopher.id;
                philosopher.held.push(stick);
            }
        });
        philosopher.waitingFor = null;
        beginEating(philosopher);
        render();
        updateDeadlock();
    }

    function beginEating(philosopher) {
        philosopher.state = 'Eating';
        philosopher.waitingFor = null;
        setMessage(`P${philosopher.id + 1} acquired C${philosopher.held.map(stick => stick + 1).join(' and C')} and is eating. Click P${philosopher.id + 1} again to release both.`);
    }

    function releaseResources(philosopher) {
        philosopher.held.forEach(stick => {
            if (chopsticks[stick] === philosopher.id) chopsticks[stick] = null;
        });
        philosopher.held = [];
        philosopher.waitingFor = null;
    }

    function detectDeadlock() {
        if (philosophers.length < 2 || philosophers.some(philosopher =>
            philosopher.state !== 'Waiting' || philosopher.held.length === 0 || philosopher.waitingFor === null
        )) return false;

        let current = 0;
        const visited = new Set();
        for (let step = 0; step < philosophers.length; step += 1) {
            if (visited.has(current)) return false;
            visited.add(current);
            const owner = chopsticks[philosophers[current].waitingFor];
            if (owner === null || owner === current) return false;
            current = owner;
        }
        return current === 0 && visited.size === philosophers.length;
    }

    function updateDeadlock() {
        const wasDeadlocked = deadlocked;
        deadlocked = detectDeadlock();
        if (deadlocked && !wasDeadlocked) {
            deadlockOccurred = true;
            score -= 30;
            stopTimer();
            setStatus('DEADLOCK', 'deadlocked');
            setMessage('Deadlock detected: every philosopher holds one chopstick and waits in a circle. Release a chopstick to break the cycle. -30 points.', 'danger');
        } else if (!deadlocked && wasDeadlocked) {
            setStatus('PAUSED', 'paused');
            document.getElementById('start-button').textContent = 'Resume Game';
            setMessage('Circular wait broken. Resume when you are ready.', 'normal');
        }
        render();
    }

    function gameTick() {
        if (!running || gameOver) return;
        survivalTicks += 1;
        if (survivalTicks % 2 === 0) score += 1;
        elapsedSeconds += intervalMs / 1000;
        philosophers.forEach(philosopher => {
            if (philosopher.state === 'Thinking') philosopher.health -= 0.15;
            if (philosopher.state === 'Hungry') philosopher.health -= 0.7;
            if (philosopher.state === 'Waiting') philosopher.health -= 1;
            if (philosopher.state === 'Eating') philosopher.health += 2.2;
            philosopher.health = Math.max(0, Math.min(100, philosopher.health));
        });
        render();

        const starved = philosophers.find(philosopher => philosopher.health <= 0);
        if (starved) finishGame(starved);
    }

    function finishGame(starved) {
        stopTimer();
        gameOver = true;
        setStatus('GAME OVER', 'over');
        document.getElementById('result-title').textContent = `Game Over - Philosopher ${starved.id + 1} starved.`;
        document.getElementById('result-score').textContent = score;
        document.getElementById('result-fed').textContent = `${fedCount} / ${philosophers.length}`;
        document.getElementById('result-deadlock').textContent = deadlockOccurred ? 'Yes' : 'No';
        document.getElementById('result-conflicts').textContent = conflicts;
        document.getElementById('result-feedback').textContent = `Philosopher ${starved.id + 1}'s health reached zero after ${fedCount} of ${philosophers.length} philosophers were fed. ${deadlockOccurred ? 'A circular wait also occurred during the round.' : 'No deadlock occurred.'}${conflicts > 0 ? ` ${conflicts} resource conflicts cost points.` : ''}`;
        resultPanel.hidden = false;
        setMessage(`Game Over - Philosopher ${starved.id + 1} starved.`, 'warning');
        render();
    }

    function startGame() {
        if (running || gameOver || deadlocked) return;
        running = true;
        setStatus('RUNNING', 'running');
        document.getElementById('start-button').textContent = 'Resume Game';
        setMessage('Round active. Select a philosopher and allocate their chopsticks.');
        timer = window.setInterval(gameTick, intervalMs);
        render();
    }

    function pauseGame() {
        if (!running) return;
        stopTimer();
        setStatus('PAUSED', 'paused');
        setMessage('Game paused. Your allocation and elapsed time are saved.');
        render();
    }

    function render() {
        scoreDisplay.textContent = score;
        timeDisplay.textContent = Math.floor(elapsedSeconds);
        fedDisplay.textContent = fedCount;
        conflictDisplay.textContent = conflicts;
        freeDisplay.textContent = chopsticks.filter(owner => owner === null).length;
        deadlockIndicator.textContent = deadlocked ? 'Deadlock detected' : deadlockOccurred ? 'Deadlock occurred' : 'No deadlock';
        deadlockIndicator.classList.toggle('is-deadlocked', deadlocked || deadlockOccurred);

        const selected = selectedPhilosopher();
        selectedLabel.textContent = `Philosopher ${selected.id + 1}`;
        selectedState.textContent = `${selected.state} · ${Math.round(selected.health)}% health`;
        const canAct = running && !gameOver && !deadlocked;
        document.getElementById('make-hungry-button').disabled = !canAct || selected.state !== 'Thinking';
        document.getElementById('take-left-button').disabled = gameOver || !canAct || selected.state === 'Eating' || selected.held.includes(selected.left);
        document.getElementById('take-right-button').disabled = gameOver || !canAct || selected.state === 'Eating' || selected.held.includes(selected.right);
        document.getElementById('take-both-button').disabled = gameOver || !canAct || selected.state === 'Thinking' || selected.state === 'Eating' || selected.held.length === 2;

        philosophers.forEach(philosopher => {
            const seat = document.getElementById(`philosopher-${philosopher.id}`);
            seat.dataset.state = philosopher.state.toLowerCase();
            seat.dataset.fed = String(philosopher.fed);
            seat.classList.toggle('is-selected', philosopher.id === selectedId);
            seat.setAttribute('aria-pressed', String(philosopher.id === selectedId));
            seat.setAttribute('aria-label', `Philosopher ${philosopher.id + 1}, ${philosopher.state}, health ${Math.round(philosopher.health)} percent${philosopher.fed ? ', fed' : ''}`);
            seat.querySelector('.state-label').textContent = philosopher.state;
            seat.querySelector('.seat-detail').textContent = philosopher.state === 'Eating'
                ? 'Click again to release'
                : philosopher.fed
                    ? 'Fed this round'
                    : philosopher.waitingFor !== null
                    ? `Waiting for C${philosopher.waitingFor + 1}`
                    : philosopher.held.length === 2
                        ? 'Both chopsticks ready'
                        : philosopher.held.length === 1
                            ? `Holding C${philosopher.held[0] + 1}`
                            : 'Ready to work';
            const healthFill = seat.querySelector('.seat-health-fill');
            const health = Math.round(philosopher.health);
            healthFill.style.width = `${philosopher.health}%`;
            healthFill.dataset.level = health <= 25 ? 'low' : health <= 55 ? 'medium' : 'high';
            seat.querySelector('.seat-health').setAttribute('aria-valuenow', health);
        });

        chopsticks.forEach((owner, index) => {
            const stick = document.getElementById(`chopstick-${index}`);
            const span = stick.querySelector('span');
            const holder = owner === null ? null : philosophers[owner];
            stick.classList.toggle('is-held', owner !== null);
            stick.classList.toggle('is-used', holder?.state === 'Eating');
            if (!holder) {
                stick.style.left = `${stick.dataset.homeLeft}%`;
                stick.style.top = `${stick.dataset.homeTop}%`;
                span.textContent = `C${index + 1} FREE`;
                stick.title = `Chopstick ${index + 1}: available`;
            } else {
                const angle = (2 * Math.PI * owner) / philosophers.length - Math.PI / 2;
                const order = holder.held.indexOf(index);
                const side = order === 0 ? -1 : 1;
                stick.style.left = `${50 + Math.cos(angle) * 29 - Math.sin(angle) * side * 2}%`;
                stick.style.top = `${50 + Math.sin(angle) * 26 + Math.cos(angle) * side * 2}%`;
                span.textContent = `C${index + 1} P${owner + 1}${holder.state === 'Eating' ? ' EAT' : ''}`;
                stick.title = `Chopstick ${index + 1}: ${holder.state === 'Eating' ? 'being used by' : 'assigned to'} philosopher ${owner + 1}`;
            }
            stick.setAttribute('aria-label', stick.title);
        });

        roster.replaceChildren(...philosophers.map(philosopher => {
            const row = document.createElement('div');
            row.className = `roster-row${philosopher.id === selectedId ? ' is-selected' : ''}`;
            row.dataset.state = philosopher.state.toLowerCase();
            const health = Math.round(philosopher.health);
            const level = health <= 25 ? 'low' : health <= 55 ? 'medium' : 'high';
            row.innerHTML = `<div class="roster-heading"><strong>P${philosopher.id + 1}${philosopher.fed ? ' +' : ''}</strong><span class="roster-state">${philosopher.state}</span></div><div class="health-track" role="progressbar" aria-label="P${philosopher.id + 1} health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${health}"><span class="health-fill" data-level="${level}" style="width: ${philosopher.health}%"></span></div><small>${health}%</small>`;
            return row;
        }));
    }

    document.getElementById('start-button').addEventListener('click', startGame);
    document.getElementById('pause-button').addEventListener('click', pauseGame);
    document.getElementById('reset-button').addEventListener('click', buildTable);
    document.getElementById('new-game-button').addEventListener('click', buildTable);
    document.getElementById('result-new-game-button').addEventListener('click', buildTable);
    document.getElementById('make-hungry-button').addEventListener('click', makeHungry);
    document.getElementById('take-left-button').addEventListener('click', takeLeftChopstick);
    document.getElementById('take-right-button').addEventListener('click', takeRightChopstick);
    document.getElementById('take-both-button').addEventListener('click', takeBothChopsticks);
    countInput.addEventListener('change', buildTable);

    buildTable();
})();