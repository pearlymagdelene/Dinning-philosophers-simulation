(() => {
    const actorName = document.body.dataset.actorName || 'Philosopher';
    const resourceName = document.body.dataset.resourceName || 'fork';
    const resourcePlural = document.body.dataset.resourcePlural || 'forks';
    const resourceShort = document.body.dataset.resourceShort || 'F';
    const queueResourceMotion = document.body.dataset.resourceMotion === 'queue';
    const avatar = document.body.dataset.avatar || '';
    const countInput = document.getElementById('philosopherCount');
    const modeSelect = document.getElementById('preventionMode');
    const firstChopstickSelect = document.getElementById('firstChopstick');
    const table = document.getElementById('table');
    const philosophersLayer = document.getElementById('philosophers');
    const forksLayer = document.getElementById('forks');
    const statusPanel = document.getElementById('statusPanel');
    const statusBadge = document.getElementById('simulationStatus');
    const message = document.getElementById('message');
    const eatingCount = document.getElementById('eatingCount');
    const waitingCount = document.getElementById('waitingCount');
    const freeForkCount = document.getElementById('freeForkCount');
    const deadlockIndicator = document.getElementById('deadlockIndicator');
    const intervalMs = 650;
    let philosophers = [];
    let forks = [];
    let timer = null;
    let running = false;
    let deadlocked = false;
    let tickNumber = 0;
    let scheduledOwners = [];
    let resourceMovementQueue = [];
    let resourceMovementActive = false;

    function createPhilosopher(index, count) {
        return {
            id: index,
            leftFork: index,
            rightFork: (index + 1) % count,
            state: 'Thinking',
            heldForks: [],
            planPosition: 0,
            remaining: 1 + (index % 3),
            waitTicks: 0
        };
    }

    function setMessage(text, type = 'secondary') {
        message.className = `alert alert-${type} text-center`;
        message.textContent = text;
    }

    function setSimulationStatus(text, state) {
        statusBadge.textContent = text;
        statusBadge.dataset.state = state;
    }

    function buildTable() {
        const count = Math.max(2, Math.min(10, Number(countInput.value) || 5));
        countInput.value = count;
        table.dataset.count = count;
        philosophers = Array.from({ length: count }, (_, index) => createPhilosopher(index, count));
        forks = Array(count).fill(null);
        scheduledOwners = Array(count).fill(null);
        resourceMovementQueue = [];
        resourceMovementActive = false;
        deadlocked = false;
        tickNumber = 0;
        philosophersLayer.replaceChildren();
        forksLayer.replaceChildren();
        table.querySelector('.table-center')?.remove();

        const center = document.createElement('div');
        center.className = 'table-center';
        center.innerHTML = `<strong>${actorName.toUpperCase()} TABLE</strong><span>${resourcePlural} are exclusive resources</span>`;
        table.append(center);

        philosophers.forEach((philosopher, index) => {
            const angle = (2 * Math.PI * index) / count - Math.PI / 2;
            const seatRadiusX = actorName === 'Wizard' ? 40 : 34;
            const seatRadiusY = actorName === 'Wizard' ? 36 : 31;
            const seat = document.createElement('div');
            seat.className = 'philosopher-seat';
            seat.id = `philosopher-${index}`;
            seat.innerHTML = `${avatar ? `<span class="seat-avatar" aria-hidden="true">${avatar}</span>` : ''}<span class="seat-number">${actorName === 'Wizard' ? 'MAGE' : 'P'}${index + 1}</span><strong class="seat-state">Thinking</strong><span class="seat-detail">Not requesting</span>`;
            seat.style.left = `${50 + Math.cos(angle) * seatRadiusX}%`;
            seat.style.top = `${50 + Math.sin(angle) * seatRadiusY}%`;
            philosophersLayer.append(seat);

            const forkAngle = angle + Math.PI / count;
            const fork = document.createElement('div');
            fork.className = 'fork-token';
            fork.id = `fork-${index}`;
            fork.innerHTML = `<span>${resourceShort}${index + 1}</span>`;
            fork.dataset.homeLeft = `${50 + Math.cos(forkAngle) * 24}`;
            fork.dataset.homeTop = `${50 + Math.sin(forkAngle) * 25}`;
            fork.style.left = `${fork.dataset.homeLeft}%`;
            fork.style.top = `${fork.dataset.homeTop}%`;
            fork.dataset.homeAngle = `${(forkAngle * 180 / Math.PI) + 90}deg`;
            fork.style.setProperty('--stick-angle', fork.dataset.homeAngle);
            forksLayer.append(fork);
        });

        render();
        setSimulationStatus('READY', 'ready');
        setMessage(`${count} ${actorName.toLowerCase()}s and ${count} ${resourcePlural} are ready. Choose a strategy and start the simulation.`);
    }

    function forkOrder(philosopher) {
        if (modeSelect.value === 'ordering') {
            return [philosopher.leftFork, philosopher.rightFork].sort((a, b) => a - b);
        }
        const handOrder = [philosopher.leftFork, philosopher.rightFork];
        return firstChopstickSelect.value === 'right' ? handOrder.reverse() : handOrder;
    }

    function mayJoinContenders(philosopher) {
        if (modeSelect.value !== 'limit' || philosopher.heldForks.length > 0) return true;
        const activeCount = philosophers.filter(item => item.state !== 'Thinking').length;
        return activeCount < philosophers.length - 1;
    }

    function releaseForks(philosopher) {
        philosopher.heldForks.forEach(forkIndex => {
            if (forks[forkIndex] === philosopher.id) forks[forkIndex] = null;
        });
        philosopher.heldForks = [];
        philosopher.planPosition = 0;
    }

    function advance() {
        tickNumber += 1;
        philosophers.forEach(philosopher => {
            if (philosopher.state === 'Eating') {
                philosopher.remaining -= 1;
                if (philosopher.remaining <= 0) {
                    releaseForks(philosopher);
                    philosopher.state = 'Thinking';
                    philosopher.remaining = 1 + ((philosopher.id + tickNumber) % 3);
                    philosopher.waitTicks = 0;
                }
            } else if (philosopher.state === 'Thinking') {
                philosopher.remaining -= 1;
                if (philosopher.remaining <= 0) {
                    philosopher.state = 'Hungry';
                    philosopher.planPosition = 0;
                }
            }
        });

        philosophers.forEach(philosopher => {
            if (philosopher.state !== 'Hungry' && philosopher.state !== 'Waiting') return;
            if (!mayJoinContenders(philosopher)) {
                philosopher.state = 'Waiting';
                philosopher.waitTicks += 1;
                return;
            }

            const plan = forkOrder(philosopher);
            const requestedFork = plan[philosopher.planPosition];
            if (forks[requestedFork] === null) {
                forks[requestedFork] = philosopher.id;
                philosopher.heldForks.push(requestedFork);
                philosopher.planPosition += 1;
                if (philosopher.heldForks.length === 2) {
                    philosopher.state = 'Eating';
                    philosopher.remaining = 2 + (philosopher.id % 3);
                    philosopher.waitTicks = 0;
                } else {
                    philosopher.state = 'Waiting';
                }
            } else {
                philosopher.state = 'Waiting';
                philosopher.waitTicks += 1;
            }
        });

        deadlocked = detectDeadlock();
        render();
        if (deadlocked) {
            setSimulationStatus('DEADLOCK', 'deadlocked');
            setMessage(`Deadlock detected: every ${actorName.toLowerCase()} holds one ${resourceName} and waits for one owned by a neighbor.`, 'danger');
        } else {
            setSimulationStatus('RUNNING', 'running');
            setMessage(modeSelect.value === 'unsafe'
                ? `Naive mode is active: every ${actorName.toLowerCase()} requests the ${firstChopstickSelect.value}-hand chopstick first. Observe whether circular wait forms.`
                : `${modeSelect.options[modeSelect.selectedIndex].text} is coordinating ${resourcePlural} requests.`, 'info');
        }
    }

    function detectDeadlock() {
        if (philosophers.length < 2) return false;
        const waitingWithFork = philosophers.filter(philosopher =>
            philosopher.state === 'Waiting' && philosopher.heldForks.length > 0
        );
        if (waitingWithFork.length !== philosophers.length) return false;
        return waitingWithFork.every(philosopher => {
            const requestedFork = forkOrder(philosopher)[philosopher.planPosition];
            const owner = forks[requestedFork];
            return owner !== null && owner !== philosopher.id;
        });
    }

    function resourceDestination(index, owner, heldOrder) {
        if (owner === null) {
            const token = document.getElementById(`fork-${index}`);
            return { left: token.dataset.homeLeft, top: token.dataset.homeTop, angle: token.dataset.homeAngle };
        }

        const angle = (2 * Math.PI * owner) / philosophers.length - Math.PI / 2;
        const side = heldOrder === 0 ? -1 : 1;
        const tangentX = -Math.sin(angle);
        const tangentY = Math.cos(angle);
        const holderRadiusX = actorName === 'Wizard' ? 31 : 25;
        const holderRadiusY = actorName === 'Wizard' ? 21 : 20;
        return {
            left: `${50 + Math.cos(angle) * holderRadiusX + tangentX * side * 2.4}`,
            top: `${50 + Math.sin(angle) * holderRadiusY + tangentY * side * 2.4}`,
            angle: `${Math.atan2(tangentY, tangentX) * 180 / Math.PI}deg`
        };
    }

    function moveNextResource() {
        if (!queueResourceMotion || resourceMovementActive || resourceMovementQueue.length === 0) return;
        const movement = resourceMovementQueue.shift();
        const token = document.getElementById(`fork-${movement.index}`);
        const destination = resourceDestination(movement.index, movement.owner, movement.heldOrder);
        resourceMovementActive = true;
        token.classList.toggle('is-held', movement.owner !== null);
        token.title = movement.owner === null
            ? `${resourceName} ${movement.index + 1}: available`
            : `${resourceName} ${movement.index + 1}: held by ${actorName.toLowerCase()} ${movement.owner + 1}`;
        token.setAttribute('aria-label', token.title);
        token.style.left = `${destination.left}%`;
        token.style.top = `${destination.top}%`;
        if (destination.angle !== null) token.style.setProperty('--stick-angle', destination.angle);
        window.setTimeout(() => {
            resourceMovementActive = false;
            moveNextResource();
        }, 280);
    }

    function syncResourceMovement() {
        forks.forEach((owner, index) => {
            if (scheduledOwners[index] === owner) return;
            const heldOrder = owner === null ? -1 : philosophers[owner].heldForks.indexOf(index);
            scheduledOwners[index] = owner;
            resourceMovementQueue.push({ index, owner, heldOrder });
        });
        moveNextResource();
    }

    function render() {
        const waiting = philosophers.filter(philosopher => philosopher.state === 'Waiting' || philosopher.state === 'Hungry').length;
        const eating = philosophers.filter(philosopher => philosopher.state === 'Eating').length;
        eatingCount.textContent = eating;
        waitingCount.textContent = waiting;
        freeForkCount.textContent = forks.filter(owner => owner === null).length;
        deadlockIndicator.textContent = deadlocked ? 'Deadlock detected' : 'No deadlock';
        deadlockIndicator.classList.toggle('is-deadlocked', deadlocked);

        philosophers.forEach(philosopher => {
            const seat = document.getElementById(`philosopher-${philosopher.id}`);
            const state = seat.querySelector('.seat-state');
            const detail = seat.querySelector('.seat-detail');
            seat.dataset.state = philosopher.state.toLowerCase();
            state.textContent = philosopher.state;
            detail.textContent = philosopher.state === 'Eating'
                ? `Holding ${resourceShort}${philosopher.heldForks.map(index => index + 1).join(` + ${resourceShort}`)}`
                : philosopher.heldForks.length
                    ? `Holding ${resourceShort}${philosopher.heldForks[0] + 1}; waiting for another`
                    : philosopher.waitTicks > 8
                        ? 'Waiting for a long time'
                        : philosopher.state === 'Thinking' ? 'Not requesting' : `Requesting both ${resourcePlural}`;
        });

        forks.forEach((owner, index) => {
            const token = document.getElementById(`fork-${index}`);
            if (!queueResourceMotion) {
            token.classList.toggle('is-held', owner !== null);
                token.title = owner === null ? `${resourceName} ${index + 1}: available` : `${resourceName} ${index + 1}: held by ${actorName.toLowerCase()} ${owner + 1}`;
                token.setAttribute('aria-label', token.title);
            }
        });
        if (queueResourceMotion) syncResourceMovement();

        statusPanel.replaceChildren(...philosophers.map(philosopher => {
            const card = document.createElement('div');
            card.className = 'col-6 col-lg-4';
            card.innerHTML = `<article class="status-card" data-state="${philosopher.state.toLowerCase()}"><div><strong>${actorName} ${philosopher.id + 1}</strong><span class="status-state">${philosopher.state}</span></div><small>${resourcePlural}: ${philosopher.heldForks.length ? philosopher.heldForks.map(index => `${resourceShort}${index + 1}`).join(', ') : 'none'} · waiting ${philosopher.waitTicks} ticks</small></article>`;
            return card;
        }));
    }

    function start() {
        if (running) return;
        running = true;
        setSimulationStatus('RUNNING', 'running');
        timer = window.setInterval(advance, intervalMs);
        advance();
    }

    function pause() {
        if (!running) return;
        window.clearInterval(timer);
        timer = null;
        running = false;
        setSimulationStatus('PAUSED', 'paused');
        setMessage('Simulation paused. Start resumes from the current resource allocation.', 'warning');
    }

    document.getElementById('startBtn').addEventListener('click', start);
    document.getElementById('pauseBtn').addEventListener('click', pause);
    document.getElementById('resetBtn').addEventListener('click', () => {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        running = false;
        modeSelect.value = 'ordering';
        buildTable();
    });
    document.getElementById('deadlockBtn').addEventListener('click', () => {
        if (timer !== null) window.clearInterval(timer);
        running = false;
        modeSelect.value = 'unsafe';
        buildTable();
        philosophers.forEach(philosopher => {
            philosopher.state = 'Hungry';
            philosopher.remaining = 0;
        });
        setMessage(`Deadlock demonstration started: all ${actorName.toLowerCase()}s request their first ${resourceName} before the next.`, 'warning');
        start();
    });
    document.getElementById('preventBtn').addEventListener('click', () => {
        modeSelect.value = 'ordering';
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        running = false;
        buildTable();
        setMessage(`Resource ordering is enabled. Every ${actorName.toLowerCase()} requests the lower-numbered ${resourceName} first, preventing circular wait.`, 'success');
        start();
    });
    countInput.addEventListener('change', () => {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        running = false;
        buildTable();
    });
    modeSelect.addEventListener('change', () => {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        running = false;
        buildTable();
        setMessage('Strategy changed. Start the simulation to observe this synchronization approach.');
    });
    firstChopstickSelect.addEventListener('change', () => {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        running = false;
        buildTable();
        setMessage('First-chopstick preference updated. It applies to contender-limit and naive modes.');
    });

    buildTable();
})();