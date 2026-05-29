import * as migration_20260529_061408_initial from './20260529_061408_initial';

export const migrations = [
  {
    up: migration_20260529_061408_initial.up,
    down: migration_20260529_061408_initial.down,
    name: '20260529_061408_initial'
  },
];
