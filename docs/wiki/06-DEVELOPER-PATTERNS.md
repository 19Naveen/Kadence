# How the System Is Built

Every feature in the backend — no matter which module — follows the same recurring shape. Once you understand this shape, any part of the codebase becomes easier to navigate, because the same questions ("where does validation happen?", "where do I look for business rules?") always have the same kind of answer.

## The five-layer shape

Each module is built from five kinds of pieces, each with one job:

1. **Models** — define what gets permanently stored (a User, a Workspace, a Dataset, a Version) and how those things relate to each other.
2. **Schemas** — define the shape of data going in and out of the API: what a request must look like to be valid, and what a response contains. This is also where input validation lives (e.g., "a username must be 3–50 characters").
3. **Repository** — the only layer allowed to talk to the database directly. It knows how to create, find, update, and delete records, but has no opinions about business rules.
4. **Service** — the business rules layer. It decides *what should happen*: "reject signup if the username is taken," "a job can only be resolved if it's still pending," "a dataset with no versions can't be queried."
5. **Router** — the outermost layer, exposing HTTP endpoints. It parses the request, checks the user is authenticated, calls into the service layer, and shapes the response. Routers intentionally contain little to no logic themselves.

Data flows in one direction: **Router → Service → Repository → Database**, and results flow back out the same path in reverse. A router never talks to the database directly, and a repository never enforces business rules — each layer stays focused on its one job.

## Why this separation matters

- **Predictability.** Once you know the shape, you know where to look. Need to know what makes a signup request valid? Check the schema. Need to know why a request was rejected? Check the service. Need to know exactly what gets saved? Check the repository.
- **Safety.** Because only the repository layer touches the database, it's straightforward to reason about every place data can change.
- **Testability.** Business rules (service layer) can be tested without needing a real HTTP request, and data access (repository layer) can be tested without needing to simulate business logic.

## Authentication, applied consistently

Every endpoint that should require a logged-in user depends on the same authentication check. This means protecting a new endpoint is a one-line addition, not a custom implementation each time — and it means there's exactly one place that defines "what counts as a valid session" for the whole system.

## Background work follows the same discipline

Whenever an operation is too slow to run inside a normal request (importing a full dataset, for example), the router hands the work off to a background task rather than doing it inline. The task itself still respects the same layering — it calls into the repository to read/update records, just like a router would, so the rules for "how data gets written" don't fork into two different code paths depending on whether the work is synchronous or not.

## Testing

The backend has an automated test suite covering the trickier logic — schema-diff computation, transform application, engine selection, and the full commit pipeline. Tests exercise the service and pipeline layers directly rather than going through real HTTP requests, which keeps them fast and focused on business logic rather than web plumbing.

## Consistency as the codebase grows

Because every module follows the same five-layer shape, adding a new module (say, a future "Notifications" or "Sharing" feature) means following a known recipe rather than inventing a new structure. See [Growing the System](08-EXTENDING-THE-SYSTEM.md) for what that recipe looks like in practice.
