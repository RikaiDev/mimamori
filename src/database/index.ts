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
