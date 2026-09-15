# DocuValidate — System Design & UML Documentation

This document describes the actual architecture, data models, and request flows of the DocuValidate (TrOCR) web application, based on a direct inspection of the codebase and connected Supabase schema.

---

## 1. System Architecture Diagram

The application uses a modern hybrid rendering architecture (Next.js App Router) with a distinct separation between presentation, server-side logic, and a fully managed backend as a service (Supabase).

```mermaid
flowchart TD
    subgraph Client ["Client Browser"]
        UI["React UI (Client Components)"]
        Hooks["Custom Hooks (useCamera, useOcr)"]
        UI <--> Hooks
    end

    subgraph AppServer ["Next.js Server (Vercel)"]
        Middleware["Next.js Middleware (Auth Routing)"]
        Actions["Server Actions (auth.ts, admin.ts)"]
        API["API Routes (/api/ocr, /api/documents)"]
        Parser["OCR Parser & Validation Engine"]
    end

    subgraph Backend ["Supabase (PostgreSQL)"]
        Auth["Supabase Auth"]
        DB[(PostgreSQL Database)]
        Storage["Storage (documents bucket)"]
        Triggers["DB Triggers (on_auth_user_created)"]
        Auth --> Triggers
        Triggers --> DB
    end

    subgraph External ["External Services"]
        Mistral["Mistral AI API"]
        Email["Gmail SMTP (Nodemailer)"]
    end

    %% Flow connections
    Client --> Middleware
    Middleware --> UI
    UI --> Actions
    UI --> API
    
    Actions --> Auth
    Actions --> DB
    Actions --> Email
    
    API --> Mistral
    API --> DB
    API --> Storage
    API --> Parser
```

**Interpretation:**
The system architecture follows a standard Next.js App Router pattern. Incoming requests first hit the Next.js `middleware.ts`, which validates session cookies via Supabase Auth and redirects unauthenticated users to `/login`. The Client Browser runs React Client Components (e.g., `useCamera`, `useCropper`) to handle device hardware and image processing. When a user acts, the UI communicates with the Next.js Server either via Server Actions (for auth and admin tasks) or API Routes (for OCR and data fetching). The server executes business logic (like the `ValidationEngine` and `MistralOcrClient`) and connects securely to Supabase for database operations, storage, and authentication. Supabase handles database-level logic, such as triggers that automatically assign roles to new users.

**Step-by-Step Request Flow (Admin Invites Teacher):**
1. The Admin fills out the "Teacher Email" form in the Settings UI and clicks "Send Access Code".
2. The form triggers the `generateTeacherCode` Server Action.
3. The Action queries the `user_roles` table in Supabase to verify the requesting user has the `'admin'` role.
4. The Action generates a random 6-character access code and inserts it into the `teacher_invites` Supabase table.
5. The Action uses `nodemailer` to connect to the external Gmail SMTP server and sends the access code to the provided email.
6. The Action revalidates the UI path and returns a success message to the Client.

---

## 2. Use Case Diagram

There are exactly two distinct user roles implemented in the database and RLS policies: **Admin** and **Teacher**. 

```mermaid
usecaseDiagram
    actor Admin
    actor Teacher

    package "DocuValidate Navigation" {
        usecase "UC1: View Dashboard Stats" as UC1
        usecase "UC1a: View Auth Logs" as UC1a
        usecase "UC2: Upload & Extract Document" as UC2
        usecase "UC3: Browse Documents" as UC3
        usecase "UC4: Process Review Queue" as UC4
        usecase "UC5: View Student Directory" as UC5
        usecase "UC6: View Reports" as UC6
        usecase "UC7: View Settings" as UC7
        usecase "UC7a: Generate Teacher Invites" as UC7a
    }

    Teacher --> UC1
    Teacher --> UC2
    Teacher --> UC3
    Teacher --> UC4
    Teacher --> UC5
    Teacher --> UC6
    Teacher --> UC7

    Admin --> UC1
    Admin --> UC1a
    Admin --> UC2
    Admin --> UC3
    Admin --> UC4
    Admin --> UC5
    Admin --> UC6
    Admin --> UC7
    Admin --> UC7a
```

**Interpretation:**
The navigation sidebar renders the exact same primary links for both roles, in this order: Dashboard, Upload Document, Documents, Review Queue, Students, Reports, and Settings. However, the capabilities within those views differ by role. Admins have extended permissions: they can view User Activity (Auth Logs) on the Dashboard (`UC1a`), and they have the ability to generate and email Teacher Access Codes in the Settings view (`UC7a`). Teachers can access the Settings page but are met with an "Admin Privileges Required" block.

---

## 3. Class / Data Model Diagram

This diagram maps 1:1 to the actual Supabase database schema and migrations (`001_initial_schema.sql`, `002_auth_rbac.sql`, `combined_setup.sql`).

```mermaid
classDiagram
    class schools {
        +uuid id [PK]
        +text name
        +text school_id [UK]
        +text division
        +text region
        +boolean is_active
        +timestamptz created_at
    }

    class students {
        +uuid id [PK]
        +text lrn [UK]
        +text first_name
        +text middle_name
        +text last_name
        +text suffix
        +date birth_date
        +text sex
        +text grade_level
        +uuid school_id [FK]
        +text status
        +timestamptz created_at
        +timestamptz updated_at
        ++trigger update_updated_at()
    }

    class documents {
        +uuid id [PK]
        +uuid student_id [FK]
        +text document_type
        +text image_url
        +text original_filename
        +text extracted_text
        +jsonb extracted_fields
        +text ocr_model
        +real ocr_confidence
        +text status
        +text uploaded_by
        +timestamptz created_at
        +timestamptz updated_at
        ++trigger update_updated_at()
    }

    class validation_results {
        +uuid id [PK]
        +uuid document_id [FK]
        +text rule_name
        +text field_name
        +boolean passed
        +text expected_value
        +text actual_value
        +text message
        +timestamptz created_at
    }

    class review_logs {
        +uuid id [PK]
        +uuid document_id [FK]
        +text action
        +text previous_status
        +text new_status
        +jsonb corrections
        +text comment
        +text reviewed_by
        +timestamptz created_at
    }

    class user_roles {
        +uuid id [PK]
        +uuid user_id [FK -> auth.users]
        +user_role role
        +timestamptz created_at
    }

    class auth_logs {
        +uuid id [PK]
        +uuid user_id [FK -> auth.users]
        +text action
        +text ip_address
        +timestamptz created_at
    }

    class teacher_invites {
        +uuid id [PK]
        +text email
        +text access_code
        +timestamptz created_at
        +boolean used
    }

    schools "1" <-- "many" students : school_id
    students "1" <-- "many" documents : student_id
    documents "1" <-- "many" validation_results : document_id
    documents "1" <-- "many" review_logs : document_id
```

**Interpretation:**
The database design centers around `documents` and `students`. When a document is processed, it is linked to a student (if successfully identified) via `student_id`. The automated `ValidationEngine` writes its findings to `validation_results`, which are uniquely tied to a specific document. Any manual teacher interventions are audited in `review_logs`. Security and RBAC (Role-Based Access Control) are managed by linking `user_roles` and `auth_logs` directly to Supabase's internal `auth.users` table.

---

## 4. Sequence Diagrams

### 4.1 Document Upload & OCR Extraction
Maps the flow from the `/upload` page UI through the Mistral API and Validation Engine.

```mermaid
sequenceDiagram
    participant UI as UploadPage (Client)
    participant Hook as useOcr (Client)
    participant API as /api/ocr (Route)
    participant Mistral as Mistral AI
    participant Parser as OcrParser

    UI->>Hook: extract(base64Image)
    Hook->>API: POST { image, extractFields: true }
    API->>Mistral: POST /v1/ocr
    Mistral-->>API: Response { pages: [markdown] }
    API->>Parser: parseOcrText(markdown)
    Parser-->>API: ExtractedFields (Name, LRN, Grade...)
    API-->>Hook: OcrResponse { text, fields, confidence }
    Hook-->>UI: Sets OCR Result UI State
```

**Interpretation:**
This sequence highlights the application's reliance on client-side hooks to communicate with the Next.js API. The `/api/ocr` route acts as a secure proxy, holding the `MISTRAL_API_KEY` so it is never exposed to the client. After Mistral returns raw markdown, the backend runs the `OcrParser` (using RegEx pattern matching) to convert the unstructured text into a structured JSON `ExtractedFields` object before returning it to the browser.

### 4.2 Teacher Registration (Access Code Validation)
Maps the secure registration flow using Server Actions.

```mermaid
sequenceDiagram
    participant UI as RegisterPage (Client)
    participant Action as auth.ts (Server Action)
    participant DB as Supabase DB
    participant Auth as Supabase Auth

    UI->>Action: register(email, pass, accessCode)
    Action->>DB: SELECT * FROM teacher_invites WHERE email & code
    DB-->>Action: Returns valid invite
    Action->>DB: UPDATE teacher_invites SET used = true
    Action->>Auth: signUp({ email, password })
    Auth-->>DB: DB Trigger: handle_new_user()
    DB->>DB: INSERT INTO user_roles (role: 'teacher')
    Auth-->>Action: Success / Session
    Action-->>UI: redirect("/")
```

**Interpretation:**
This sequence demonstrates the secure sign-up process. The Next.js Server Action (`auth.ts`) handles the registration request directly. It queries the `teacher_invites` table to validate the access code. If valid, the invite is burned (marked as used), and the user is created in Supabase Auth. A Postgres trigger (`on_auth_user_created`) automatically intercepts the creation event and assigns the new user a default `'teacher'` role in the `user_roles` table.

---

## 5. Package / Module Diagram

```mermaid
flowchart TB
    subgraph Presentation ["app/ (App Router)"]
        Login["login/"]
        Dashboard["page.tsx (Dashboard)"]
        Upload["upload/"]
        Docs["documents/"]
        Review["review/"]
        Students["students/"]
    end

    subgraph UIComponents ["components/"]
        AuthUI["auth/"]
        CameraUI["camera/"]
        DashboardUI["dashboard/"]
        DocUI["documents/"]
        LayoutUI["layout/"]
        ValUI["validation/"]
    end

    subgraph ClientHooks ["hooks/"]
        HCamera["useCamera.ts"]
        HCrop["useCropper.ts"]
        HImg["useImageProcessor.ts"]
        HOcr["useOcr.ts"]
    end

    subgraph ServerControllers ["actions/ & api/"]
        AuthAction["actions/auth.ts"]
        AdminAction["actions/admin.ts"]
        ApiOcr["api/ocr/"]
        ApiDocs["api/documents/"]
        ApiVal["api/validation/"]
    end

    subgraph CoreLogic ["lib/"]
        OcrLib["ocr/ (Mistral, Parser)"]
        ValLib["validation/ (Engine, Rules)"]
        SupaLib["supabase/ (Server Client)"]
    end

    subgraph DBConfig ["supabase/"]
        Migrations["migrations/ (*.sql)"]
    end

    Presentation --> UIComponents
    Presentation --> ClientHooks
    UIComponents --> ClientHooks
    Presentation --> ServerControllers
    ServerControllers --> CoreLogic
    CoreLogic --> SupaLib
    SupaLib -.-> Migrations
```

**Interpretation:**
The folder structure maps cleanly to architectural layers. `app/` handles routing and page layouts. `components/` and `hooks/` encapsulate the complex client-side view logic (like hardware camera access and image cropping). The `actions/` and `api/` directories form the controller layer, mediating between the client and the core business logic found in `lib/`. The database schema and security rules are version-controlled in `supabase/migrations/`.

---

## 6. Deployment Diagram

```mermaid
flowchart TD
    nodeBrowser["Client Browser (React/DOM)"]
    
    subgraph Vercel ["Vercel (Next.js App)"]
        nodeEdge["Edge Network (Static Assets)"]
        nodeNode["Node.js Serverless Functions (API & Actions)"]
    end
    
    subgraph SupabasePlatform ["Supabase Cloud"]
        nodePostgres[("PostgreSQL Database\n(Schema, RLS, Triggers)")]
        nodeAuth["GoTrue Auth Server"]
        nodeStorage["Storage API (S3 Bucket)"]
    end
    
    subgraph ExternalAPIs ["External Integrations"]
        nodeMistral["Mistral AI API\n(api.mistral.ai)"]
        nodeGmail["Gmail SMTP Server\n(smtp.gmail.com)"]
    end

    nodeBrowser -- "HTTPS" --> nodeEdge
    nodeBrowser -- "HTTPS / JSON" --> nodeNode
    
    nodeNode -- "HTTPS / pg" --> nodePostgres
    nodeNode -- "HTTPS" --> nodeAuth
    nodeNode -- "HTTPS" --> nodeStorage
    
    nodeNode -- "HTTPS / JSON" --> nodeMistral
    nodeNode -- "SMTP (Port 587/465)" --> nodeGmail
```

**Interpretation:**
The application is deployed across managed cloud providers. Vercel hosts the Next.js application, serving static files via its Edge network and executing Server Actions and API routes in serverless Node.js functions. Supabase acts as the persistence and authentication layer, providing a managed PostgreSQL database, GoTrue authentication, and file storage for uploaded document images. External calls are made securely from the Vercel serverless environment to Mistral AI via HTTPS API calls and to Gmail via SMTP for outgoing teacher invites. No database credentials or third-party API keys are exposed to the Client Browser.
