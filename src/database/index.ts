/**
 * Database module exports
 */

export { initializeDatabase } from './schema.js';
export {
  DatabaseManager,
  MessageRepository,
  InteractionRepository,
  AlertRepository,
  type StoredMessage,
  type Interaction,
  type Alert,
  type ContextMessage,
} from './repository.js';
export {
  SignalRepository,
  createSignalTables,
  calculateTrend,
  formatSignalForContext,
  type UserSignal,
  type DailySnapshot,
  type IssueBreakdown,
  type SeverityBreakdown,
} from './signals.js';
