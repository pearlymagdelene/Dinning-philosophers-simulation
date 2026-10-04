#include <stdbool.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define API EMSCRIPTEN_KEEPALIVE
#else
#include <stdio.h>
#define API
#endif

#define MAX_PHILOSOPHERS 10

typedef enum {
    STATE_THINKING,
    STATE_HUNGRY,
    STATE_WAITING,
    STATE_EATING
} PhilosopherState;

typedef struct {
    int id;
    int leftChopstick;
    int rightChopstick;
    PhilosopherState state;
    int held[2];
    int heldCount;
    int planPosition;
    int remaining;
    int waitTicks;
} Philosopher;

typedef struct {
    int value;
    int waiters;
    int maximum;
} Semaphore;

static Philosopher philosophers[MAX_PHILOSOPHERS];
static int chopstickOwners[MAX_PHILOSOPHERS];
static Semaphore monitorMutex;
static Semaphore conditionSemaphores[MAX_PHILOSOPHERS];
static int semaphoreWaitCount;
static int semaphoreSignalCount;
static int philosopherCount = 5;
static int simulationMode;
static int rightHandFirst;
static int wizardMode;
static int tickNumber;
static bool running;
static bool deadlocked;

static bool semaphoreWait(Semaphore* semaphore) {
    semaphoreWaitCount++;
    if (semaphore->value > 0) {
        semaphore->value--;
        return true;
    }
    semaphore->waiters++;
    return false;
}

static void semaphoreSignal(Semaphore* semaphore) {
    semaphoreSignalCount++;
    if (semaphore->waiters > 0) {
        semaphore->waiters--;
    } else if (semaphore->value < semaphore->maximum) {
        semaphore->value++;
    }
}

static bool canEatInMonitor(int index) {
    int leftNeighbor = (index + philosopherCount - 1) % philosopherCount;
    int rightNeighbor = (index + 1) % philosopherCount;
    Philosopher* philosopher = &philosophers[index];
    return philosophers[leftNeighbor].state != STATE_EATING &&
        philosophers[rightNeighbor].state != STATE_EATING &&
        chopstickOwners[philosopher->leftChopstick] == -1 &&
        chopstickOwners[philosopher->rightChopstick] == -1;
}

static void monitorGrant(int index, bool wakingWaiter) {
    Philosopher* philosopher = &philosophers[index];
    philosopher->state = STATE_EATING;
    philosopher->held[0] = philosopher->leftChopstick;
    philosopher->held[1] = philosopher->rightChopstick;
    philosopher->heldCount = 2;
    philosopher->remaining = 2 + philosopher->id % 3;
    philosopher->waitTicks = 0;
    philosopher->planPosition = 2;
    chopstickOwners[philosopher->leftChopstick] = index;
    chopstickOwners[philosopher->rightChopstick] = index;
    if (wakingWaiter) semaphoreSignal(&conditionSemaphores[index]);
}

static void monitorTest(int index) {
    Philosopher* philosopher = &philosophers[index];
    if ((philosopher->state == STATE_HUNGRY || philosopher->state == STATE_WAITING) && canEatInMonitor(index)) {
        monitorGrant(index, philosopher->state == STATE_WAITING);
    }
}

static void monitorTake(int index) {
    Philosopher* philosopher = &philosophers[index];
    semaphoreWait(&monitorMutex);
    philosopher->state = STATE_HUNGRY;
    monitorTest(index);
    if (philosopher->state != STATE_EATING) {
        philosopher->state = STATE_WAITING;
        semaphoreWait(&conditionSemaphores[index]);
        philosopher->waitTicks++;
    }
    semaphoreSignal(&monitorMutex);
}

static void monitorRelease(int index) {
    Philosopher* philosopher = &philosophers[index];
    int leftNeighbor = (index + philosopherCount - 1) % philosopherCount;
    int rightNeighbor = (index + 1) % philosopherCount;
    semaphoreWait(&monitorMutex);
    chopstickOwners[philosopher->leftChopstick] = -1;
    chopstickOwners[philosopher->rightChopstick] = -1;
    philosopher->held[0] = -1;
    philosopher->held[1] = -1;
    philosopher->heldCount = 0;
    philosopher->planPosition = 0;
    philosopher->state = STATE_THINKING;
    philosopher->remaining = 1 + (philosopher->id + tickNumber) % 3;
    monitorTest(leftNeighbor);
    monitorTest(rightNeighbor);
    semaphoreSignal(&monitorMutex);
}

static void resetState(void) {
    tickNumber = 0;
    running = false;
    deadlocked = false;
    monitorMutex = (Semaphore){ .value = 1, .waiters = 0, .maximum = 1 };
    semaphoreWaitCount = 0;
    semaphoreSignalCount = 0;
    for (int index = 0; index < philosopherCount; index++) {
        philosophers[index] = (Philosopher){
            .id = index,
            .leftChopstick = index,
            .rightChopstick = (index + 1) % philosopherCount,
            .state = STATE_THINKING,
            .held = {-1, -1},
            .heldCount = 0,
            .planPosition = 0,
            .remaining = 1 + index % 3,
            .waitTicks = 0
        };
        chopstickOwners[index] = -1;
        conditionSemaphores[index] = (Semaphore){ .value = 0, .waiters = 0, .maximum = 1 };
    }
}

static void forkOrder(const Philosopher* philosopher, int order[2]) {
    if (simulationMode == 0) {
        order[0] = philosopher->leftChopstick;
        order[1] = philosopher->rightChopstick;
        if (order[0] > order[1]) {
            int swap = order[0];
            order[0] = order[1];
            order[1] = swap;
        }
        return;
    }
    order[0] = rightHandFirst ? philosopher->rightChopstick : philosopher->leftChopstick;
    order[1] = rightHandFirst ? philosopher->leftChopstick : philosopher->rightChopstick;
}

static bool mayJoinContenders(const Philosopher* philosopher) {
    if (simulationMode != 1 || philosopher->heldCount > 0) return true;
    int active = 0;
    for (int index = 0; index < philosopherCount; index++) {
        if (philosophers[index].state != STATE_THINKING) active++;
    }
    return active < philosopherCount - 1;
}

static void releaseChopsticks(Philosopher* philosopher) {
    for (int index = 0; index < philosopher->heldCount; index++) {
        int chopstick = philosopher->held[index];
        if (chopstickOwners[chopstick] == philosopher->id) chopstickOwners[chopstick] = -1;
    }
    philosopher->held[0] = -1;
    philosopher->held[1] = -1;
    philosopher->heldCount = 0;
    philosopher->planPosition = 0;
}

static bool detectDeadlock(void) {
    if (simulationMode == 3) return false;
    for (int index = 0; index < philosopherCount; index++) {
        Philosopher* philosopher = &philosophers[index];
        if (philosopher->state != STATE_WAITING || philosopher->heldCount == 0) return false;
        int order[2];
        forkOrder(philosopher, order);
        int requested = order[philosopher->planPosition];
        if (chopstickOwners[requested] < 0 || chopstickOwners[requested] == philosopher->id) return false;
    }
    return true;
}

static void advance(void) {
    if (deadlocked) return;
    tickNumber++;

    for (int index = 0; index < philosopherCount; index++) {
        Philosopher* philosopher = &philosophers[index];
        if (philosopher->state == STATE_EATING) {
            philosopher->remaining--;
            if (philosopher->remaining <= 0) {
                if (simulationMode == 3) {
                    monitorRelease(index);
                } else {
                    releaseChopsticks(philosopher);
                    philosopher->state = STATE_THINKING;
                    philosopher->remaining = 1 + (philosopher->id + tickNumber) % 3;
                    philosopher->waitTicks = 0;
                }
            }
        } else if (philosopher->state == STATE_THINKING) {
            philosopher->remaining--;
            if (philosopher->remaining <= 0) {
                philosopher->state = STATE_HUNGRY;
                philosopher->planPosition = 0;
            }
        }
    }

    for (int index = 0; index < philosopherCount; index++) {
        Philosopher* philosopher = &philosophers[index];
        if (simulationMode == 3) {
            if (philosopher->state == STATE_HUNGRY) monitorTake(index);
            else if (philosopher->state == STATE_WAITING) philosopher->waitTicks++;
            continue;
        }
        if (philosopher->state != STATE_HUNGRY && philosopher->state != STATE_WAITING) continue;
        if (!mayJoinContenders(philosopher)) {
            philosopher->state = STATE_WAITING;
            philosopher->waitTicks++;
            continue;
        }

        int order[2];
        forkOrder(philosopher, order);
        int requested = order[philosopher->planPosition];
        if (chopstickOwners[requested] == -1) {
            chopstickOwners[requested] = philosopher->id;
            philosopher->held[philosopher->heldCount++] = requested;
            philosopher->planPosition++;
            if (philosopher->heldCount == 2) {
                philosopher->state = STATE_EATING;
                philosopher->remaining = 2 + philosopher->id % 3;
                philosopher->waitTicks = 0;
            } else {
                philosopher->state = STATE_WAITING;
            }
        } else {
            philosopher->state = STATE_WAITING;
            philosopher->waitTicks++;
        }
    }
    deadlocked = detectDeadlock();
    if (deadlocked) running = false;
}

API void sim_init(int count, int isWizard) {
    if (count < 2) count = 2;
    if (count > MAX_PHILOSOPHERS) count = MAX_PHILOSOPHERS;
    philosopherCount = count;
    wizardMode = isWizard != 0;
    simulationMode = 0;
    rightHandFirst = 0;
    resetState();
}

API void sim_set_count(int count) {
    if (count < 2) count = 2;
    if (count > MAX_PHILOSOPHERS) count = MAX_PHILOSOPHERS;
    philosopherCount = count;
    resetState();
}

API void sim_set_mode(int mode) {
    if (mode < 0 || mode > 3) mode = 0;
    simulationMode = mode;
    resetState();
}

API void sim_set_first_hand(int rightFirst) {
    rightHandFirst = rightFirst != 0;
    resetState();
}

API void sim_start(void) {
    if (deadlocked) return;
    running = true;
    advance();
}

API void sim_tick(void) {
    if (running) advance();
}

API void sim_pause(void) {
    running = false;
}

API void sim_reset(void) {
    simulationMode = 0;
    resetState();
}

API void sim_deadlock_demo(void) {
    simulationMode = 2;
    resetState();
    for (int index = 0; index < philosopherCount; index++) {
        philosophers[index].state = STATE_HUNGRY;
        philosophers[index].remaining = 0;
    }
    running = true;
    advance();
}

API void sim_prevent_deadlock(void) {
    simulationMode = 0;
    resetState();
    running = true;
    advance();
}

API int sim_get_count(void) { return philosopherCount; }
API int sim_get_mode(void) { return simulationMode; }
API int sim_get_hand(void) { return rightHandFirst; }
API int sim_get_is_wizard(void) { return wizardMode; }
API int sim_get_tick(void) { return tickNumber; }
API int sim_get_running(void) { return running; }
API int sim_get_deadlocked(void) { return deadlocked; }
API int sim_get_state(int index) { return (index >= 0 && index < philosopherCount) ? philosophers[index].state : -1; }
API int sim_get_wait_ticks(int index) { return (index >= 0 && index < philosopherCount) ? philosophers[index].waitTicks : 0; }
API int sim_get_held_count(int index) { return (index >= 0 && index < philosopherCount) ? philosophers[index].heldCount : 0; }
API int sim_get_held_chopstick(int index, int heldIndex) {
    return (index >= 0 && index < philosopherCount && heldIndex >= 0 && heldIndex < philosophers[index].heldCount)
        ? philosophers[index].held[heldIndex] : -1;
}
API int sim_get_chopstick_owner(int index) { return (index >= 0 && index < philosopherCount) ? chopstickOwners[index] : -1; }

API int sim_get_eating_count(void) {
    int total = 0;
    for (int index = 0; index < philosopherCount; index++) if (philosophers[index].state == STATE_EATING) total++;
    return total;
}

API int sim_get_waiting_count(void) {
    int total = 0;
    for (int index = 0; index < philosopherCount; index++) {
        if (philosophers[index].state == STATE_WAITING || philosophers[index].state == STATE_HUNGRY) total++;
    }
    return total;
}

API int sim_get_free_chopstick_count(void) {
    int total = 0;
    for (int index = 0; index < philosopherCount; index++) if (chopstickOwners[index] < 0) total++;
    return total;
}

API int sim_get_semaphore_wait_count(void) { return semaphoreWaitCount; }
API int sim_get_semaphore_signal_count(void) { return semaphoreSignalCount; }
API int sim_get_mutex_value(void) { return monitorMutex.value; }
API int sim_get_monitor_waiters(void) {
    int total = 0;
    for (int index = 0; index < philosopherCount; index++) total += conditionSemaphores[index].waiters;
    return total;
}

#ifndef __EMSCRIPTEN__
int main(void) {
    sim_init(5, 0);
    sim_deadlock_demo();
    if (!sim_get_deadlocked()) return 1;
    sim_prevent_deadlock();
    if (sim_get_deadlocked()) return 1;
    sim_set_mode(3);
    sim_start();
    for (int tick = 0; tick < 80; tick++) sim_tick();
    if (sim_get_deadlocked() || sim_get_mutex_value() != 1) return 1;
    if (sim_get_semaphore_wait_count() == 0 || sim_get_semaphore_signal_count() == 0) return 1;
    for (int index = 0; index < philosopherCount; index++) {
        if (philosophers[index].state == STATE_EATING && philosophers[index].heldCount != 2) return 1;
        if (philosophers[index].state == STATE_EATING &&
            philosophers[(index + 1) % philosopherCount].state == STATE_EATING) return 1;
    }
    printf("C simulator tests passed: deadlock/prevention and monitor wait=%d signal=%d, mutex released.\n",
           sim_get_semaphore_wait_count(), sim_get_semaphore_signal_count());
    return 0;
}
#endif
