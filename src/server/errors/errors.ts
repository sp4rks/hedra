/** Raised when a configuration value is missing or fails validation. */
export class ConfigurationError extends Error {
  readonly status: number
  readonly title: string
  readonly detail?: string | object

  /** Records the HTTP status, a short title and the detail callers report. */
  constructor(status = 500, title = 'configuration error', detail?: string | object) {
    super(title)
    this.name = 'ConfigurationError'
    this.status = status
    this.title = title
    this.detail = detail
  }
}
