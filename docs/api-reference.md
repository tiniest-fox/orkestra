# Orkestra API Reference

This document provides the API reference for the Orkestra task orchestration system.

## Authentication

All API requests require authentication via Bearer token in the Authorization header.

```
Authorization: Bearer <your-api-token>
```

### Obtaining a Token

Tokens can be generated via the CLI:

```bash
ork auth token create --name "my-token" --expires 30d
```

Or through the `/auth/token` endpoint:

```http
POST /auth/token
Content-Type: application/json

{
  "username": "admin",
  "password": "your-password"
}
```

**Response:**
```json
{
  "token": "ork_live_abc123...",
  "expires_at": "2024-03-15T12:00:00Z"
}
```

---

## Endpoints

### Tasks

#### List Tasks

Retrieve all tasks, optionally filtered by status.

```http
GET /api/v1/tasks
```

**Query Parameters:**

| Parameter | Type   | Required | Description                          |
|-----------|--------|----------|--------------------------------------|
| status    | string | No       | Filter by status (e.g., `pending`)   |
| limit     | int    | No       | Maximum results (default: 50)        |
| offset    | int    | No       | Pagination offset (default: 0)       |

**Example Request:**
```bash
curl -X GET "https://api.orkestra.dev/api/v1/tasks?status=pending&limit=10" \
  -H "Authorization: Bearer ork_live_abc123..."
```

**Example Response:**
```json
{
  "tasks": [
    {
      "id": "TASK-001",
      "title": "Implement user authentication",
      "description": "Add OAuth2 login flow",
      "status": "pending",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": "TASK-002",
      "title": "Fix database connection pooling",
      "description": "Connection pool exhaustion under load",
      "status": "pending",
      "created_at": "2024-01-15T11:00:00Z",
      "updated_at": "2024-01-15T11:00:00Z"
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

---

#### Get Task

Retrieve a single task by ID.

```http
GET /api/v1/tasks/{task_id}
```

**Path Parameters:**

| Parameter | Type   | Required | Description    |
|-----------|--------|----------|----------------|
| task_id   | string | Yes      | The task ID    |

**Example Request:**
```bash
curl -X GET "https://api.orkestra.dev/api/v1/tasks/TASK-001" \
  -H "Authorization: Bearer ork_live_abc123..."
```

**Example Response:**
```json
{
  "id": "TASK-001",
  "title": "Implement user authentication",
  "description": "Add OAuth2 login flow with Google and GitHub providers",
  "status": "in_progress",
  "plan": "1. Set up OAuth2 client credentials\n2. Create auth routes\n3. Implement token storage",
  "parent_id": null,
  "subtasks": ["TASK-001-A", "TASK-001-B"],
  "logs": [
    {
      "timestamp": "2024-01-15T10:35:00Z",
      "level": "info",
      "message": "Planning phase started"
    }
  ],
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T12:45:00Z"
}
```

---

#### Create Task

Create a new task.

```http
POST /api/v1/tasks
```

**Request Body:**

| Field       | Type   | Required | Description                        |
|-------------|--------|----------|------------------------------------|
| title       | string | Yes      | Task title                         |
| description | string | Yes      | Detailed task description          |
| parent_id   | string | No       | Parent task ID for subtasks        |
| priority    | string | No       | Priority: low, medium, high        |

**Example Request:**
```bash
curl -X POST "https://api.orkestra.dev/api/v1/tasks" \
  -H "Authorization: Bearer ork_live_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Add dark mode support",
    "description": "Implement dark mode theme toggle in the UI",
    "priority": "medium"
  }'
```

**Example Response:**
```json
{
  "id": "TASK-003",
  "title": "Add dark mode support",
  "description": "Implement dark mode theme toggle in the UI",
  "status": "pending",
  "priority": "medium",
  "created_at": "2024-01-15T14:00:00Z",
  "updated_at": "2024-01-15T14:00:00Z"
}
```

---

#### Update Task Status

Update a task's status.

```http
PATCH /api/v1/tasks/{task_id}/status
```

**Request Body:**

| Field   | Type   | Required | Description                              |
|---------|--------|----------|------------------------------------------|
| status  | string | Yes      | New status                               |
| reason  | string | No       | Reason for status change (for blocked/failed) |

**Valid Status Transitions:**

- `pending` → `planning`
- `planning` → `awaiting_approval`
- `awaiting_approval` → `in_progress` (approve) or `planning` (request changes)
- `in_progress` → `ready_for_review`, `blocked`, `failed`
- `ready_for_review` → `done` (approve) or `in_progress` (request changes)

**Example Request:**
```bash
curl -X PATCH "https://api.orkestra.dev/api/v1/tasks/TASK-001/status" \
  -H "Authorization: Bearer ork_live_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "status": "blocked",
    "reason": "Waiting for database credentials"
  }'
```

**Example Response:**
```json
{
  "id": "TASK-001",
  "status": "blocked",
  "blocked_reason": "Waiting for database credentials",
  "updated_at": "2024-01-15T15:30:00Z"
}
```

---

#### Complete Task

Mark a task as complete (ready for review).

```http
POST /api/v1/tasks/{task_id}/complete
```

**Request Body:**

| Field   | Type   | Required | Description                    |
|---------|--------|----------|--------------------------------|
| summary | string | Yes      | Summary of work completed      |

**Example Request:**
```bash
curl -X POST "https://api.orkestra.dev/api/v1/tasks/TASK-001/complete" \
  -H "Authorization: Bearer ork_live_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Implemented OAuth2 flow with Google and GitHub providers. Added token refresh logic."
  }'
```

**Example Response:**
```json
{
  "id": "TASK-001",
  "status": "ready_for_review",
  "summary": "Implemented OAuth2 flow with Google and GitHub providers. Added token refresh logic.",
  "updated_at": "2024-01-15T16:00:00Z"
}
```

---

### Agents

#### List Active Agents

Retrieve all currently running agents.

```http
GET /api/v1/agents
```

**Example Response:**
```json
{
  "agents": [
    {
      "id": "agent-001",
      "task_id": "TASK-001",
      "type": "worker",
      "status": "running",
      "started_at": "2024-01-15T14:30:00Z"
    }
  ]
}
```

---

#### Spawn Agent

Manually spawn an agent for a task.

```http
POST /api/v1/agents
```

**Request Body:**

| Field   | Type   | Required | Description                    |
|---------|--------|----------|--------------------------------|
| task_id | string | Yes      | Task ID to assign agent        |
| type    | string | Yes      | Agent type: planner, worker    |

**Example Request:**
```bash
curl -X POST "https://api.orkestra.dev/api/v1/agents" \
  -H "Authorization: Bearer ork_live_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "TASK-001",
    "type": "worker"
  }'
```

**Example Response:**
```json
{
  "id": "agent-002",
  "task_id": "TASK-001",
  "type": "worker",
  "status": "starting",
  "started_at": "2024-01-15T14:35:00Z"
}
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task with ID 'TASK-999' not found",
    "details": {}
  }
}
```

### Common Error Codes

| Code                  | HTTP Status | Description                          |
|-----------------------|-------------|--------------------------------------|
| UNAUTHORIZED          | 401         | Invalid or missing auth token        |
| FORBIDDEN             | 403         | Insufficient permissions             |
| TASK_NOT_FOUND        | 404         | Task does not exist                  |
| INVALID_TRANSITION    | 400         | Invalid status transition            |
| VALIDATION_ERROR      | 400         | Request body validation failed       |
| AGENT_ALREADY_RUNNING | 409         | Agent already running for this task  |
| RATE_LIMITED          | 429         | Too many requests                    |

---

## Rate Limiting

API requests are rate limited to:
- 100 requests per minute for standard endpoints
- 10 requests per minute for agent spawn operations

Rate limit headers are included in all responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705329600
```

---

## Webhooks

Configure webhooks to receive task status updates.

```http
POST /api/v1/webhooks
```

**Request Body:**

| Field  | Type     | Required | Description                    |
|--------|----------|----------|--------------------------------|
| url    | string   | Yes      | Webhook destination URL        |
| events | string[] | Yes      | Events to subscribe to         |
| secret | string   | No       | HMAC secret for verification   |

**Available Events:**
- `task.created`
- `task.status_changed`
- `task.completed`
- `task.failed`
- `agent.started`
- `agent.stopped`

**Webhook Payload Example:**
```json
{
  "event": "task.status_changed",
  "timestamp": "2024-01-15T14:30:00Z",
  "data": {
    "task_id": "TASK-001",
    "old_status": "planning",
    "new_status": "awaiting_approval"
  }
}
```

---

## SDK Examples

### Python

```python
from orkestra import Client

client = Client(api_key="ork_live_abc123...")

# Create a task
task = client.tasks.create(
    title="Implement feature X",
    description="Add new functionality..."
)

# List pending tasks
pending = client.tasks.list(status="pending")

# Complete a task
client.tasks.complete(task.id, summary="Feature implemented")
```

### JavaScript/TypeScript

```typescript
import { OrkestraClient } from '@orkestra/sdk';

const client = new OrkestraClient({ apiKey: 'ork_live_abc123...' });

// Create a task
const task = await client.tasks.create({
  title: 'Implement feature X',
  description: 'Add new functionality...'
});

// List pending tasks
const pending = await client.tasks.list({ status: 'pending' });

// Complete a task
await client.tasks.complete(task.id, { summary: 'Feature implemented' });
```

---

## Changelog

### v1.0.0 (2024-01-15)
- Initial API release
- Task CRUD operations
- Agent management endpoints
- Webhook support
