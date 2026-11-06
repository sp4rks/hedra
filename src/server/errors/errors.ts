/** Raised when a configuration value is missing or fails validation. */
export class HedraError extends Error {
  declare name: string
  declare status: number
  declare title: string
  declare detail?: string | object

  constructor(status = 500, title: string, detail?: string | object) {
    super(title)
    this.name = this.constructor.name
    this.status = status
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
  constructor(
    status = 500,
    title = 'configuration error',
    detail?: string | object,
  ) {
    super(status, title, detail)
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
  constructor(
    status = 422,
    title = 'input validation error',
    detail?: string | object,
  ) {
    super(status, title, detail)
  }
}

/**
 * Thrown when output data fails validation.
 * This indicates an internal error where the application
 * generated data that doesn't match its own schema.
 */
export class OutputValidationError extends HedraError {
  constructor(
    status = 422,
    title = 'output validation error',
    detail?: string | object,
  ) {
    super(status, title, detail)
  }
}

/**
 * Thrown when a precondition check fails.
 * For example, required headers are missing or invalid or
 * the request is made on the wrong domain.
 */
export class PreconditionFailedError extends HedraError {
  constructor(
    status = 412,
    title = 'precondition failed',
    detail?: string | object,
  ) {
    super(status, title, detail)
  }
}

/**
 * Thrown when a request is malformed or invalid.
 * This is a general-purpose error for bad requests that
 * don't fit into more specific error categories.
 */
export class BadRequestError extends HedraError {
  constructor(status = 400, title = 'bad request', detail?: string | object) {
    super(status, title, detail)
  }
}
/**
 * Base class for all database-related errors.
 * Extends M21Error to maintain consistent error handling across the application.
 */
export class DatastoreError extends HedraError {
  constructor(
    status = 500,
    title = 'datastore error',
    detail?: string | object,
  ) {
    super(status, title, detail)
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
  constructor(
    status = 500,
    title = 'failed to connect to database',
    detail?: string | object,
  ) {
    super(status, title, detail)
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
  constructor(
    status = 500,
    title = 'database query failed',
    detail?: string | object,
  ) {
    super(status, title, detail)
  }
}

/**
 * Thrown when a database operation violates a unique constraint.
 * Examples include:
 * - Unique key constraint violation
 */
export class UniqueViolationError extends DatastoreError {
  constructor(
    status = 409,
    title = 'uniqueness violation',
    detail?: string | object,
  ) {
    super(status, title, detail)
  }
}

/**
 * Thrown when a database operation violates a constraint.
 * Examples include:
 * - Foreign key constraint violation
 * - NOT NULL constraint violation
 */
export class ConstraintViolationError extends DatastoreError {
  constructor(
    status = 400,
    title = 'database constraint violation',
    detail?: string | object,
  ) {
    super(status, title, detail)
  }
}

/**
 * Thrown when attempting to access a record that doesn't exist.
 * This is different from a QueryError as it's an expected error case
 * that should be handled gracefully by the application.
 */
export class RecordNotFoundError extends DatastoreError {
  constructor(
    status = 404,
    title = 'record not found',
    detail?: string | object,
  ) {
    super(status, title, detail)
  }
}

/**
 * Thrown when a database transaction fails.
 * A transaction is a group of related operations that must either
 * all succeed or all fail together to maintain data consistency.
 */
export class TransactionError extends DatastoreError {
  constructor(
    status = 500,
    title = 'database transaction failed',
    detail?: string | object,
  ) {
    super(status, title, detail)
  }
}
