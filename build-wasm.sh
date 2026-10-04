#!/bin/sh
set -eu

emcc -O2 -nostdlib -c dining_simulator.c -o dining_simulator.o
"$(emcc --print-prog-name=wasm-ld)" \
    --no-entry \
    --export-memory \
    -z stack-size=65536 \
    --initial-memory=131072 \
    --export=sim_init \
    --export=sim_set_count \
    --export=sim_set_mode \
    --export=sim_set_first_hand \
    --export=sim_start \
    --export=sim_tick \
    --export=sim_pause \
    --export=sim_reset \
    --export=sim_deadlock_demo \
    --export=sim_prevent_deadlock \
    --export=sim_get_count \
    --export=sim_get_mode \
    --export=sim_get_hand \
    --export=sim_get_is_wizard \
    --export=sim_get_tick \
    --export=sim_get_running \
    --export=sim_get_deadlocked \
    --export=sim_get_state \
    --export=sim_get_wait_ticks \
    --export=sim_get_held_count \
    --export=sim_get_held_chopstick \
    --export=sim_get_chopstick_owner \
    --export=sim_get_eating_count \
    --export=sim_get_waiting_count \
    --export=sim_get_free_chopstick_count \
    --export=sim_get_semaphore_wait_count \
    --export=sim_get_semaphore_signal_count \
    --export=sim_get_mutex_value \
    --export=sim_get_monitor_waiters \
    dining_simulator.o \
    -o dining_simulator.wasm
rm dining_simulator.o