/** Base class for Hedra errors, with a status, title and optional detail. */
export class HedraError extends Error {
  declare name: string
  declare status: number
  declare title: string
  declare detail?: string | object

  /** Records the title and optional detail. */
  constructor(title: string, detail?: string | object) {
    super(title)
    this.name = this.constructor.name
    this.status = 500
    this.title = title
    this.detail = detail
  }
}

/**
 * Thrown when there is a configuration-related error.
 * Examples include:
 * - Missing required environment variables
 * - Invalid configuration values
 * - Configuration file not found or malformed
 * - Incompatible configuration settings
 */
export class ConfigurationError extends HedraError {
  /** Creates a configuration error with the supplied title and optional detail. */
  constructor(title = 'configuration error', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when input data fails validation.
 * Examples include:
 * - Invalid request body format
 * - Missing required fields
 * - Field values outside allowed ranges
 * - Type mismatches in request data
 */
export class InputValidationError extends HedraError {
  override status = 422

  /** Creates an input validation error with the supplied title and optional detail. */
  constructor(title = 'input validation error', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when output data fails validation.
 * This indicates an internal error where the application
 * generated data that doesn't match its own schema.
 */
export class OutputValidationError extends HedraError {
  /** Creates an output validation error with the supplied title and optional detail. */
  constructor(title = 'output validation error', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when a precondition check fails.
 * For example, required headers are missing or invalid or
 * the request is made on the wrong domain.
 */
export class PreconditionFailedError extends HedraError {
  override status = 412

  /** Creates a precondition error with the supplied title and optional detail. */
  constructor(title = 'precondition failed', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when a request is malformed or invalid.
 * This is a general-purpose error for bad requests that
 * don't fit into more specific error categories.
 */
export class BadRequestError extends HedraError {
  override status = 400

  /** Creates a bad request error with the supplied title and optional detail. */
  constructor(title = 'bad request', detail?: string | object) {
    super(title, detail)
  }
}

/** Thrown when the request conflicts with the current resource state. */
export class ConflictError extends HedraError {
  override status = 409

  /** Creates a conflict error with the supplied title and optional detail. */
  constructor(title = 'conflict', detail?: string | object) {
    super(title, detail)
  }
}

/** Thrown when a request uses an unsupported media type. */
export class UnsupportedMediaTypeError extends HedraError {
  override status = 415

  /** Creates an unsupported media type error with the supplied title and optional detail. */
  constructor(title = 'unsupported media type', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Base class for all database-related errors.
 */
export class DatastoreError extends HedraError {
  /** Creates a datastore error with the supplied title and optional detail. */
  constructor(title = 'datastore error', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when the application cannot establish a connection to the database.
 * This could be due to:
 * - Database server being down
 * - Network connectivity issues
 * - Invalid connection credentials
 * - Database server rejecting connections
 */
export class ConnectionError extends DatastoreError {
  /** Creates a connection error with the supplied title and optional detail. */
  constructor(title = 'failed to connect to database', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when a single database operation fails.
 * Examples include:
 * - Invalid SQL syntax
 * - Table doesn't exist
 * - Column type mismatch
 * - Permission denied
 */
export class QueryError extends DatastoreError {
  /** Creates a query error with the supplied title and optional detail. */
  constructor(title = 'database query failed', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when a database operation violates a unique constraint.
 * Examples include:
 * - Unique key constraint violation
 */
export class UniqueViolationError extends DatastoreError {
  override status = 409

  /** Creates a uniqueness error with the supplied title and optional detail. */
  constructor(title = 'uniqueness violation', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when a database operation violates a constraint.
 * Examples include:
 * - Foreign key constraint violation
 * - NOT NULL constraint violation
 */
export class ConstraintViolationError extends DatastoreError {
  override status = 400

  /** Creates a constraint error with the supplied title and optional detail. */
  constructor(title = 'database constraint violation', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when attempting to access a record that doesn't exist.
 * This is different from a QueryError as it's an expected error case
 * that should be handled gracefully by the application.
 */
export class RecordNotFoundError extends DatastoreError {
  override status = 404

  /** Creates a record-not-found error with the supplied title and optional detail. */
  constructor(title = 'record not found', detail?: string | object) {
    super(title, detail)
  }
}

/**
 * Thrown when a database transaction fails.
 * A transaction is a group of related operations that must either
 * all succeed or all fail together to maintain data consistency.
 */
export class TransactionError extends DatastoreError {
  /** Creates a transaction error with the supplied title and optional detail. */
  constructor(title = 'database transaction failed', detail?: string | object) {
    super(title, detail)
  }
}
