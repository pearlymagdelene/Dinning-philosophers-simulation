(() => {
    const countInput = document.getElementById('philosopher-count');
    const strategySelect = document.getElementById('strategy-select');
    const table = document.getElementById('table');
    const philosophersLayer = document.getElementById('philosophers');
    const chopsticksLayer = document.getElementById('chopsticks');
    const startButton = document.getElementById('start-button');
    const pauseButton = document.getElementById('pause-button');
    const status = document.getElementById('simulation-status');
    const explanationTitle = document.getElementById('explanation-title');
    const explanationText = document.getElementById('explanation-text');
    const eventLog = document.getElementById('event-log');
    const strategies = {
        unsafe: {
            title: 'Naive acquisition',
            text: 'Every philosopher takes the left chopstick first. They can each hold one resource while waiting for the next, completing a circular wait.'
        },
        limit: {
            title: 'At most N - 1 contenders',
            text: 'A philosopher may begin taking resources only while fewer than N - 1 philosophers already hold chopsticks. Someone can always make progress and free resources.'
        },
        ordering: {
            title: 'Global resource ordering',
            text: 'Each philosopher takes the lower-numbered neighboring chopstick first. Every wait edge points toward a higher resource, so a cycle cannot form.'
        },
        waiter: {
            title: 'Arbitrator / waiter',
            text: 'A central waiter grants both chopsticks together only when both are free. Philosophers never hold one chopstick while waiting for another.'
        },
        asymmetric: {
            title: 'Asymmetric acquisition',
            text: 'Even-numbered philosophers take left first; odd-numbered philosophers take right first. The mixed order prevents a uniform circular wait.'
        }
    };

    let philosophers = [];
    let chopsticks = [];
    let timer = null;
    let running = false;
    let deadlocked = false;
    let stepNumber = 0;

    function createPhilosopher(id, count) {
        return {
            id,
            left: (id + count - 1) % count,
            right: id,
            state: 'Thinking',
            held: [],
            waitingFor: null,
            eatTicks: 0,
            thinkTicks: 0
        };
    }

    function logEvent(text) {
        const item = document.createElement('li');
        item.textContent = text;
        eventLog.prepend(item);
        while (eventLog.children.length > 5) eventLog.lastElementChild.remove();
    }

    function setStatus(text, state) {
        status.textContent = text;
        status.dataset.state = state;
    }

    function showExplanation(title, text) {
        explanationTitle.textContent = title;
        explanationText.textContent = text;
    }

    function stopTimer() {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        running = false;
    }

    function buildTable() {
        stopTimer();
        deadlocked = false;
        stepNumber = 0;
        const count = Math.max(2, Math.min(10, Number(countInput.value) || 5));
        countInput.value = count;
        table.dataset.count = count;
        philosophers = Array.from({ length: count }, (_, id) => createPhilosopher(id, count));
        chopsticks = Array(count).fill(null);
        philosophersLayer.replaceChildren();
        chopsticksLayer.replaceChildren();

        philosophers.forEach(philosopher => {
            const angle = (2 * Math.PI * philosopher.id) / count - Math.PI / 2;
            const seat = document.createElement('div');
            seat.className = 'philosopher';
            seat.id = `philosopher-${philosopher.id}`;
            seat.innerHTML = `<strong>P${philosopher.id + 1}</strong><span class="state-label">Thinking</span>`;
            seat.style.left = `${50 + Math.cos(angle) * 37}%`;
            seat.style.top = `${50 + Math.sin(angle) * 36}%`;
            philosophersLayer.append(seat);

            const stickAngle = angle + Math.PI / count;
            const stick = document.createElement('div');
            stick.className = 'chopstick';
            stick.id = `chopstick-${philosopher.id}`;
            stick.textContent = `C${philosopher.id + 1}`;
            stick.dataset.homeLeft = `${50 + Math.cos(stickAngle) * 25}`;
            stick.dataset.homeTop = `${50 + Math.sin(stickAngle) * 25}`;
            stick.style.left = `${stick.dataset.homeLeft}%`;
            stick.style.top = `${stick.dataset.homeTop}%`;
            stick.style.setProperty('--angle', `${stickAngle * 180 / Math.PI + 90}deg`);
            chopsticksLayer.append(stick);
        });

        document.getElementById('center-note').textContent = `${count} threads / ${count} chopsticks`;
        render();
        setStatus('READY', 'ready');
    }

    function acquisitionOrder(philosopher) {
        const hands = [philosopher.left, philosopher.right];
        if (strategySelect.value === 'ordering') return hands.sort((first, second) => first - second);
        if (strategySelect.value === 'asymmetric' && philosopher.id % 2 === 1) return hands.reverse();
        return hands;
    }

    function beginEating(philosopher) {
        philosopher.state = 'Eating';
        philosopher.waitingFor = null;
        philosopher.eatTicks = 3;
        logEvent(`P${philosopher.id + 1} acquired both chopsticks and entered the critical section.`);
    }

    function releaseResources(philosopher) {
        philosopher.held.forEach(index => {
            if (chopsticks[index] === philosopher.id) chopsticks[index] = null;
        });
        philosopher.held = [];
    }

    function releaseAfterEating(philosopher) {
        releaseResources(philosopher);
        philosopher.state = 'Thinking';
        philosopher.waitingFor = null;
        philosopher.thinkTicks = 2;
        logEvent(`P${philosopher.id + 1} finished eating and released both chopsticks.`);
    }

    function requestResources(philosopher) {
        if (strategySelect.value === 'waiter') {
            // The waiter reserves the pair together, so nobody holds one stick while waiting for the other.
            if (philosophers.some(item => item.id !== philosopher.id && item.held.length > 0)) {
                philosopher.state = 'Waiting';
                philosopher.waitingFor = null;
                return;
            }
            if (chopsticks[philosopher.left] === null && chopsticks[philosopher.right] === null) {
                chopsticks[philosopher.left] = philosopher.id;
                chopsticks[philosopher.right] = philosopher.id;
                philosopher.held = [philosopher.left, philosopher.right];
                beginEating(philosopher);
            } else {
                philosopher.state = 'Waiting';
            }
            return;
        }

        const order = acquisitionOrder(philosopher);
        const nextStick = philosopher.held.length === 0
            ? order[0]
            : philosopher.left === philosopher.held[0] ? philosopher.right : philosopher.left;

        if (strategySelect.value === 'limit' && philosopher.held.length === 0) {
            const holders = philosophers.filter(item => item.held.length > 0).length;
            if (holders >= philosophers.length - 1) {
                philosopher.state = 'Waiting';
                philosopher.waitingFor = null;
                return;
            }
        }

        if (chopsticks[nextStick] !== null && chopsticks[nextStick] !== philosopher.id) {
            philosopher.state = 'Waiting';
            philosopher.waitingFor = nextStick;
            return;
        }

        chopsticks[nextStick] = philosopher.id;
        if (!philosopher.held.includes(nextStick)) philosopher.held.push(nextStick);
        if (philosopher.held.length === 2) beginEating(philosopher);
        else {
            philosopher.state = 'Waiting';
            philosopher.waitingFor = philosopher.left === nextStick ? philosopher.right : philosopher.left;
            logEvent(`P${philosopher.id + 1} holds C${nextStick + 1} and waits for C${philosopher.waitingFor + 1}.`);
        }
    }

    function advanceSimulation() {
        stepNumber += 1;
        philosophers.forEach(philosopher => {
            if (philosopher.state === 'Eating') {
                philosopher.eatTicks -= 1;
                if (philosopher.eatTicks <= 0) releaseAfterEating(philosopher);
            } else if (philosopher.state === 'Thinking') {
                philosopher.thinkTicks -= 1;
                if (philosopher.thinkTicks <= 0) philosopher.state = 'Hungry';
            }
        });

        philosophers.forEach(philosopher => {
            if (philosopher.state === 'Hungry' || philosopher.state === 'Waiting') requestResources(philosopher);
        });

        deadlocked = detectDeadlock();
        render();
        if (deadlocked) {
            stopTimer();
            setStatus('DEADLOCK', 'deadlocked');
            const waits = philosophers.map(philosopher => `P${philosopher.id + 1} holds C${philosopher.held[0] + 1} and waits for C${philosopher.waitingFor + 1}`).join('; ');
            showExplanation('Deadlock detected', `Every philosopher holds one chopstick and waits for a chopstick held by the next philosopher. ${waits}. This is circular wait, so nobody can enter the critical section.`);
            logEvent('DEADLOCK: every philosopher is part of the circular wait. Reset or choose a prevention strategy.');
        } else {
            setStatus('RUNNING', 'running');
            if (stepNumber === 1) showExplanation(strategies[strategySelect.value].title, strategies[strategySelect.value].text);
        }
    }

    function detectDeadlock() {
        // A deadlock must form one cycle containing every philosopher at the table.
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

    function render() {
        document.getElementById('eating-count').textContent = philosophers.filter(item => item.state === 'Eating').length;
        document.getElementById('waiting-count').textContent = philosophers.filter(item => item.state === 'Waiting').length;
        document.getElementById('free-count').textContent = chopsticks.filter(owner => owner === null).length;
        const deadlockStatus = document.getElementById('deadlock-status');
        deadlockStatus.textContent = deadlocked ? 'Deadlock detected' : 'No deadlock';
        deadlockStatus.classList.toggle('is-deadlocked', deadlocked);

        philosophers.forEach(philosopher => {
            const seat = document.getElementById(`philosopher-${philosopher.id}`);
            seat.dataset.state = philosopher.state.toLowerCase();
            seat.querySelector('.state-label').textContent = philosopher.state;
            seat.setAttribute('aria-label', `Philosopher ${philosopher.id + 1}: ${philosopher.state}`);
        });

        chopsticks.forEach((owner, index) => {
            const stick = document.getElementById(`chopstick-${index}`);
            const homeLeft = Number(stick.dataset.homeLeft);
            const homeTop = Number(stick.dataset.homeTop);
            stick.classList.toggle('is-held', owner !== null);
            if (owner === null) {
                stick.style.left = `${homeLeft}%`;
                stick.style.top = `${homeTop}%`;
                stick.textContent = `C${index + 1}`;
                stick.title = `Chopstick ${index + 1}: available`;
            } else {
                const angle = (2 * Math.PI * owner) / philosophers.length - Math.PI / 2;
                stick.style.left = `${50 + Math.cos(angle) * 29}%`;
                stick.style.top = `${50 + Math.sin(angle) * 27}%`;
                stick.textContent = `C${index + 1} P${owner + 1}`;
                stick.title = `Chopstick ${index + 1}: held by philosopher ${owner + 1}`;
            }
        });
    }

    function startSimulation() {
        if (running || deadlocked) return;
        if (philosophers.some(philosopher => philosopher.state === 'Thinking') && stepNumber === 0) {
            philosophers.forEach(philosopher => { philosopher.state = 'Hungry'; });
            logEvent(`Simulation started with ${philosophers.length} hungry philosophers.`);
        }
        running = true;
        setStatus('RUNNING', 'running');
        showExplanation(strategies[strategySelect.value].title, strategies[strategySelect.value].text);
        advanceSimulation();
        if (running) timer = window.setInterval(advanceSimulation, 700);
    }

    function pauseSimulation() {
        if (!running) return;
        stopTimer();
        setStatus('PAUSED', 'paused');
        showExplanation('Simulation paused', 'The resource allocation is unchanged. Resume to let the selected strategy continue.');
        logEvent('Simulation paused.');
    }

    startButton.addEventListener('click', startSimulation);
    pauseButton.addEventListener('click', pauseSimulation);
    document.getElementById('reset-button').addEventListener('click', () => {
        buildTable();
        eventLog.replaceChildren();
        logEvent('Table reset. All philosophers are thinking.');
        showExplanation('Ready to simulate', 'Start the simulation to see philosophers request their neighboring chopsticks. Change the strategy to compare how the allocation changes.');
    });
    countInput.addEventListener('change', buildTable);
    strategySelect.addEventListener('change', () => {
        buildTable();
        eventLog.replaceChildren();
        logEvent(`${strategies[strategySelect.value].title} selected.`);
        showExplanation(strategies[strategySelect.value].title, strategies[strategySelect.value].text);
    });

    buildTable();
})();