# Architecture

The Orkestra system follows a modular layered architecture with clear separation between the domain layer, service layer, and adapter layer. The core domain models represent workflow entities such as tasks, stages, and artifacts, while the service layer orchestrates business logic through specialized services like the TaskExecutionService and SubtaskService.

The adapter layer provides concrete implementations of port traits, enabling the system to interact with external dependencies such as SQLite for persistence, Git for version control, and various AI agent providers (Claude Code, OpenCode) for task execution. This hexagonal architecture approach ensures that domain logic remains isolated from infrastructure concerns, making the system testable and adaptable to different deployment environments.

Agent execution flows through a provider registry that dynamically selects appropriate spawners based on model specifications. The orchestrator loop continuously polls task state, spawns agents when tasks enter the appropriate phase, and processes structured JSON output to advance tasks through their configured workflow stages. This event-driven model allows for concurrent task execution while maintaining consistency through transactional database updates.
