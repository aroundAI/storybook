Create an **extremely detailed Engineering Design Document (EDD)** for the feature/specification before implementation begins.

The EDD must be sufficiently precise that an engineer who did not participate in the original discussion can understand the intended behavior, architecture, data model, implementation approach, testing strategy, deployment process, and production behavior without having to reconstruct missing decisions independently.

The document must proceed from **user intent and observable behavior into technical design**. Do not begin with HLD or LLD before establishing what the user is actually supposed to experience.

The complete design should establish this chain:

**User Need → User Outcome → User Journey → Requirements → System Behavior → Data Model/Flow → Architecture → HLD → LLD → Implementation → Testing → Deployment → Production Verification**

If an ambiguity exists early in this chain, identify it explicitly. Do not allow an unresolved assumption to propagate through the rest of the design.

---

## 1. Start With the User

The first question the EDD must answer is:

> **What does the user actually get when this feature exists?**

Describe the outcome in terms of observable behavior, not implementation.

Explain:

* Who the user is.
* What problem they are trying to solve.
* What they can do after the feature is implemented.
* What they could not do before.
* What they see at each important stage.
* What information they receive.
* What actions are available to them.
* What constitutes success.
* What constitutes failure.
* What state they are left in after completion.
* What persists after they leave or refresh.
* What does not persist.

This section must be understandable without any knowledge of the underlying codebase.

Do not use technical architecture as a substitute for describing the user experience.

---

## 2. Define the Complete User Journey

Describe the feature as a user journey from entry to completion.

For each stage, specify:

**User action → Expected system response → User-visible result → Next possible action**

Cover the complete journey, including:

* Entry points
* Preconditions
* Initial state
* User actions
* System responses
* Intermediate states
* Completion
* Exit points
* Navigation away
* Re-entry
* Refresh
* Cancellation
* Session interruption

The EDD should make it possible for someone to walk through the feature manually and determine whether the implementation behaves correctly.

---

## 3. Explicitly Define the Happy Path

Do not leave the happy path implicit.

Write the canonical successful scenario from beginning to end.

For every step describe:

* What the user does.
* What the system receives.
* What processing occurs.
* What data is read or changed.
* What the system returns.
* What the user sees.
* Why that result represents success.

The happy path becomes the reference behavior against which alternate paths, error handling, and tests are defined.

---

## 4. Define Every Important Alternate Path

The EDD must also describe what happens when the normal flow does not occur.

At minimum consider:

* Invalid input
* Missing input
* Empty results
* Duplicate operations
* Unauthorized users
* Forbidden actions
* Expired sessions
* Network failures
* Dependency failures
* Timeouts
* Partial responses
* Stale data
* Concurrent updates
* Retries
* Refreshes
* Browser/application restarts
* Cancellation
* Back navigation
* Unexpected data
* Large inputs
* Minimum and maximum values

For each scenario document:

**Trigger → System behavior → User-visible behavior → Recovery mechanism → Final state**

Do not describe only how the backend fails. Explain what the user experiences when it fails.

---

## 5. Establish the User-Facing Contract

Define the externally observable contract before describing the internal implementation.

Specify:

* Inputs
* Outputs
* UI states
* Loading states
* Empty states
* Success states
* Failure states
* Error messages
* Notifications
* Status indicators
* Permissions
* Visibility rules
* Data displayed
* Data editable by the user

The EDD should allow someone to answer:

> **If this feature is implemented correctly, exactly what should the user observe?**

---

## 6. Convert the User Experience Into Functional Requirements

Translate the user flows into explicit functional requirements.

Give every requirement a unique identifier.

For each requirement document:

* The required behavior
* Why it exists
* Trigger
* Preconditions
* Inputs
* Processing
* Outputs
* State changes
* User-visible result
* Success condition
* Failure condition
* Edge cases
* Dependencies
* Verification method

Every important user expectation should have a corresponding functional requirement.

---

## 7. Define Non-Functional Requirements

Document all applicable non-functional requirements, including:

* Performance
* Latency
* Throughput
* Availability
* Reliability
* Scalability
* Consistency
* Durability
* Security
* Privacy
* Compliance
* Accessibility
* Observability
* Maintainability
* Backward compatibility
* Forward compatibility
* Internationalization
* Disaster recovery
* Operational support
* Resource consumption
* Cost

Avoid vague statements such as "the system must be fast" where a measurable requirement can be established.

---

## 8. Analyze the Existing System

Before designing the change, understand what already exists.

Identify the relevant:

* Applications
* Services
* Modules
* Libraries
* APIs
* Databases
* Tables
* Queues
* Topics
* Events
* Background jobs
* Caches
* External systems
* Authentication mechanisms
* Authorization mechanisms
* Configuration
* Feature flags
* Existing workflows

Explain the current user flow and system flow.

Then identify exactly where the new feature enters or modifies that existing behavior.

---

## 9. Define the Desired System Behavior

Once the user behavior is established, translate it into system behavior.

For each significant user action, explain:

**User action → Application logic → Service interaction → Data operation → Response → User-visible result**

This section is the bridge between product requirements and engineering design.

It should make clear what the system must do internally in order to produce the externally defined behavior.

---

## 10. High-Level Architecture

Describe the proposed architecture at the system level.

Cover:

* Components
* Responsibilities
* Service boundaries
* Communication mechanisms
* APIs
* Events
* Queues
* Storage
* Caches
* External dependencies
* Trust boundaries
* Failure boundaries
* Scaling boundaries

For every significant architectural decision, explain why it exists and which requirement or constraint necessitates it.

---

## 11. Architecture and Flow Diagrams

Include diagrams wherever they provide meaningful clarity.

As applicable, provide:

* System context
* High-level architecture
* Component relationships
* User/system interaction
* Sequence flows
* Data flows
* Event flows
* Deployment architecture
* Authentication/authorization flow
* Failure/retry flow
* State transitions

The diagrams must represent the proposed implementation rather than generic architecture patterns.

---

## 12. End-to-End Data Flow

Trace important data from its origin to its final consumer.

Use the complete path:

**Source → Input → Validation → Transformation → Processing → Persistence → Retrieval → Output → User/Consumer**

Document:

* Source of the data
* Schema
* Validation
* Transformations
* Enrichment
* Filtering
* Deduplication
* Ordering
* Persistence
* Caching
* Serialization
* Consumers
* Retention
* Deletion
* Error behavior

Explicitly identify points where data could become:

* Lost
* Duplicated
* Reordered
* Stale
* Partially processed
* Incorrectly transformed

---

## 13. Data Model

Describe the conceptual and physical data model.

Cover:

* Entities
* Attributes
* Relationships
* Ownership
* Lifecycle
* Invariants
* State
* Source-of-truth fields
* Derived fields
* Denormalized fields
* Cached fields

For each important piece of data, identify which system is authoritative.

---

## 14. Database Design and Changes

Document every database modification.

Include:

* New tables
* Existing tables being modified
* Columns
* Data types
* Nullability
* Defaults
* Primary keys
* Foreign keys
* Unique constraints
* Check constraints
* Indexes
* Relationships
* Partitioning
* Retention
* Migration strategy
* Backfill strategy
* Rollback strategy

Show before/after schemas where useful.

Consider production implications such as:

* Existing data
* Table size
* Locking
* Migration duration
* Backward compatibility
* Deployment ordering
* Rollback safety

---

## 15. Low-Level Design

Describe the implementation-level design in enough detail for engineers to implement it without rediscovering the architecture.

Cover:

* Modules
* Classes
* Functions
* Interfaces
* Responsibilities
* Control flow
* State transitions
* Validation
* Error handling
* Retries
* Idempotency
* Transactions
* Concurrency
* Locking
* Caching
* Configuration
* Feature flags
* Dependency boundaries

Use pseudocode where complex logic benefits from explicit representation.

The LLD should explain the intended implementation without simply turning the EDD into source code.

---

## 16. API and Event Design

For every new or modified interface, define:

* Endpoint or event
* Producer
* Consumer
* Request schema
* Response schema
* Required fields
* Optional fields
* Defaults
* Validation
* Authentication
* Authorization
* Error responses
* Status codes
* Idempotency
* Pagination
* Filtering
* Sorting
* Versioning
* Compatibility
* Rate limits
* Timeouts

For asynchronous events additionally define:

* Delivery semantics
* Ordering
* Retry behavior
* Duplicate handling
* Dead-letter behavior
* Schema/version evolution

---

## 17. State and Lifecycle Design

Where entities have meaningful lifecycle states, define:

* All states
* Initial state
* Valid transitions
* Invalid transitions
* Transition triggers
* Side effects
* Failure behavior
* Retry behavior
* Terminal states

Provide a state-transition diagram when useful.

---

## 18. Failure and Error Handling

Do not design only the successful execution path.

For every major operation define:

**Failure condition → System behavior → User-visible behavior → Recovery**

Consider:

* Validation failures
* Dependency failures
* Timeouts
* Retries
* Partial failures
* Transaction failures
* Duplicate requests
* Concurrent modifications
* Recovery
* Dead-letter handling

The EDD should make failure behavior just as explicit as success behavior.

---

## 19. Security

Perform a security analysis of the proposed design.

Cover:

* Authentication
* Authorization
* Roles
* Permissions
* Trust boundaries
* Secrets
* Encryption
* Sensitive information
* Input validation
* Injection risks
* Data exposure
* Audit logging
* Abuse scenarios
* Rate limiting
* Tenant isolation
* Least privilege

Identify security-sensitive decisions rather than assuming they are handled elsewhere.

---

## 20. Performance and Scale

Define the operating assumptions for production.

Document:

* Expected traffic
* Peak traffic
* Data volume
* Growth
* Latency targets
* Throughput
* CPU/memory implications
* Database load
* Network load
* Cache behavior
* Potential bottlenecks
* Scaling strategy

Evaluate both normal operation and expected peak conditions.

---

## 21. Accessibility and Client Behavior

Where applicable, explicitly design:

* Keyboard interaction
* Focus management
* Screen-reader behavior
* Semantic structure
* Labels
* Error presentation
* Loading states
* Empty states
* Responsive behavior
* Browser compatibility
* Device compatibility
* Localization

These should be requirements of the feature, not an afterthought added during implementation.

---

## 22. Observability and Operations

Define how the feature will be understood and operated once deployed.

Specify:

* Logs
* Metrics
* Traces
* Dashboards
* Alerts
* Health checks
* Error tracking
* Audit events
* SLOs
* SLIs
* Important dimensions/tags

For important production behavior, answer:

> **How will an operator know that this is working correctly?**

Also define how an operator will distinguish expected behavior from failure.

---

## 23. Configuration and Feature Flags

Document:

* Configuration values
* Defaults
* Environment-specific behavior
* Secrets
* Feature flags
* Safe defaults
* Rollout controls
* Flag ownership/lifecycle

Explain behavior when configuration is absent, malformed, or changed.

---

## 24. Compatibility

Analyze compatibility with:

* Existing clients
* Existing APIs
* Existing events
* Existing schemas
* Existing database records
* Existing services
* Older application versions
* Existing workflows

If deployment order matters, document it explicitly.

---

## 25. Migration and Rollout Strategy

Describe how the feature reaches production safely.

Cover:

* Preconditions
* Infrastructure changes
* Schema changes
* Deployment ordering
* Feature-flag strategy
* Internal/test rollout
* Production rollout
* Progressive exposure
* Validation gates
* Monitoring
* Rollback triggers
* Rollback procedure
* Data rollback considerations

The rollout should be derived from the architecture and its failure modes, not added as an afterthought.

---

## 26. Testing Strategy

Testing must be derived from the **user journeys, requirements, and system behavior**.

Cover, as applicable:

* Unit tests
* Integration tests
* API tests
* Contract tests
* Database tests
* End-to-end tests
* User-flow tests
* Accessibility tests
* Performance tests
* Load tests
* Failure-injection tests
* Security tests
* Migration tests
* Backward-compatibility tests
* Regression tests

Every important user flow and requirement must have a corresponding verification method.

---

## 27. Production-Build Verification

Define how the feature will be validated in the artifact that is actually intended to run in production.

Verify:

* Production build
* Compilation/transpilation
* Bundling
* Runtime configuration
* Feature flags
* Generated artifacts
* Dependencies
* Production-like data
* Actual runtime behavior
* User-visible results

Explicitly ask:

> **Does the production build actually produce the behavior defined by the user flow and specification?**

Do not assume that source-level inspection proves production correctness.

---

## 28. Requirement Traceability

Create a traceability matrix that connects the original intent to production verification.

| User Outcome | User Flow | Requirement | Design | Component | Data/API | Test | Production Verification |
| ------------ | --------- | ----------- | ------ | --------- | -------- | ---- | ----------------------- |

Every significant requirement should have a complete path through this matrix.

This should expose cases such as:

* A requirement with no implementation
* An implementation with no corresponding requirement
* A user flow with no test
* A database change without a migration plan
* An API change without compatibility analysis
* Production behavior without explicit verification

---

## 29. Architectural Alternatives and Trade-offs

For each major design decision, record:

* Decision
* Alternatives considered
* Advantages
* Disadvantages
* Complexity
* Performance impact
* Cost
* Operational impact
* Migration implications
* Reason for choosing the proposed approach

Do not present an architectural decision without documenting the constraints that produced it.

---

## 30. Risk Register

Identify risks across:

* User experience
* Technical implementation
* Data
* Migration
* Performance
* Security
* Operations
* Dependencies
* Rollout
* Compatibility

For each risk document:

**Risk → Impact → Detection → Mitigation → Contingency**

---

## 31. Open Questions and Assumptions

Maintain an explicit record of unresolved issues.

For each item document:

* Question
* Why it matters
* Current assumption
* Information required
* Decision required

Never hide uncertainty inside the design.

If the specification is ambiguous, preserve the ambiguity explicitly until it can be resolved.

---

## 32. Implementation Plan

Break the design into concrete implementation stages.

Each stage should identify:

* What changes
* Where the changes occur
* Dependencies
* Database impact
* API/event impact
* Tests required
* Validation required
* Rollback implications

Order the work according to actual technical dependencies rather than simply listing tasks in arbitrary order.

---

## 33. Definition of Done

The feature should not be considered complete merely because the code compiles or the primary test passes.

Completion requires, as applicable:

* The intended user outcome is achieved.
* The complete happy path works.
* Alternate paths are handled.
* Error paths are defined and verified.
* Functional requirements are satisfied.
* Non-functional requirements are addressed.
* Data flows correctly.
* Database changes are safe.
* APIs/events are compatible.
* Accessibility requirements are verified.
* Tests pass.
* The production build is verified.
* Production-like behavior is verified.
* Observability exists.
* Rollout is defined.
* Rollback is defined.
* Requirement traceability is complete.
* Critical design questions are resolved.

---

## 34. Final Consistency Pass

Once the EDD is written, review it in **both directions**.

### Forward review

Start with the user:

**What problem exists?**
→ **What outcome does the user need?**
→ **What does the user do?**
→ **What does the user expect at every step?**
→ **What must the system do?**
→ **What data must exist or change?**
→ **What architecture supports that behavior?**
→ **How is it implemented?**
→ **How is it tested?**
→ **How is it deployed?**
→ **How is production behavior verified?**

### Reverse review

Start with the implementation:

**What will the production system actually do?**
→ **What data will it create/change/read?**
→ **What services and components participate?**
→ **What user behavior does that produce?**
→ **Does that behavior satisfy the defined user flow?**
→ **Does the user flow satisfy the original requirements?**
→ **Does the final behavior actually deliver the intended user outcome?**

These two paths must converge.

If the technical design is internally consistent but produces a different user experience from the one defined at the beginning, the EDD is not correct.

---

## Fundamental Rule

The EDD must answer **both sides of the contract**:

**What the user is supposed to experience**
and
**what the system must technically do to make that experience happen.**

The user-facing definition comes first because it is the reference point for everything else.

A useful mental model is:

**User Need**
↓
**Expected User Outcome**
↓
**Complete User Journey**
↓
**Happy Path + Alternate/Error Paths**
↓
**Functional Requirements**
↓
**Non-Functional Requirements**
↓
**System Behavior**
↓
**Data Model + Data Flow**
↓
**HLD**
↓
**LLD**
↓
**APIs / Events / DB Changes**
↓
**Implementation Plan**
↓
**Testing**
↓
**Deployment / Rollout / Rollback**
↓
**Production Verification**

The EDD should make every transition in that chain explicit.

If the user outcome is vague, the flow is vague. If the flow is vague, the requirements are ambiguous. If the requirements are ambiguous, the architecture can diverge. If the architecture diverges, the implementation, tests, and production behavior can all be technically valid while still delivering the wrong feature.

**Therefore, do not allow the EDD to proceed past an ambiguous user outcome or ambiguous user flow without explicitly recording the ambiguity as an open question or assumption.**
