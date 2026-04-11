export type AppBlockingIssueSeverity = 'error' | 'warning'

export type AppBlockingIssue = {
  id: string
  severity: AppBlockingIssueSeverity
  message: string
}
