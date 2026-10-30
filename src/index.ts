export {
  validate,
  compare,
  createBaseline,
  ContractInputError,
} from './core.js';
export type {
  Diagnostic,
  ValidationReport,
  ComparisonReport,
  Report,
  Baseline,
  InputErrorCode,
} from './core.js';

export {
  createMigrationPlan,
  MigrationInputError,
  dryRunMigration,
} from './migration.js';
export type {
  MigrationPlan,
  MigrationOperation,
  MigrationErrorCode,
  MigrationReport,
} from './migration.js';
