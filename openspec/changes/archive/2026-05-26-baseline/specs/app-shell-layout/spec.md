## ADDED Requirements

### Requirement: Shell components are isolated from view data
The application shell (NavRail, TopBarShell, WorkflowStageStrip) SHALL depend only on workflow model state and active-view routing state, not on view-specific service data (e.g., KB records, chat messages).

#### Scenario: NavRail renders without active KB
- **WHEN** the application loads with no knowledge base configured
- **THEN** the NavRail renders navigation items using only UiRole and AppMainView state, without errors or empty-state warnings from KB services

#### Scenario: TopBarShell renders workflow controls
- **WHEN** the active view maps to a workflow stage
- **THEN** TopBarShell displays the WorkflowStageStrip with the current stage highlighted and adjacent stages navigable

### Requirement: App-shell components reside in the app-shell package
All shell-level UI components — NavRail, TopBarShell, WorkflowStageStrip, WelcomeChecklistModal, DeleteConversationModal — SHALL be defined under `src/renderer/app-shell/` and SHALL NOT import from view-specific modules outside that package except via props or context.

#### Scenario: Shell component import boundary
- **WHEN** a static import analysis is run on `src/renderer/app-shell/`
- **THEN** no file in `app-shell/` imports directly from view modules (e.g., KnowledgeBaseView, TrainMainView) — only from `@shared/`, renderer hooks, and the workflow model

### Requirement: Lazy-loaded views remain accessible after extraction
Views removed from eager imports in `App.tsx` (e.g., KeywordGraphSigmaView, OntologyView, TrainMainView) SHALL remain accessible via their existing route/view identifier with no regression in navigation.

#### Scenario: Lazy-loaded view navigation
- **WHEN** a user navigates to a view that was converted to lazy import
- **THEN** the view loads within 2 s on first navigation and renders its content without a white-screen error
