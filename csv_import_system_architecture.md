# CSV Import & Notification System: Architecture & Flow

This document details the complete end-to-end architecture of the Booking Import system, from CSV upload to guest notifications and automated reminders.

## 1. System Overview

The system is designed to be **asynchronous**, **scalable**, and **idempotent**. It decouples the upload process from the heavy lifting of database insertion and third-party API calls.

### Core Components
1.  **Frontend**: React UI for mapping CSV columns and uploading.
2.  **API Layer**: Supabase Edge Functions for handling file upload (`upload-import-csv`).
3.  **Database**: Staging tables (`import_batches`, `import_rows`) and core tables (`bookings`, `notification_queue`).
4.  **Worker Layer**: Scheduled background jobs (`process-import-rows`, `send-notifications`, `generate-reminders`) running via `pg_cron`.

---

## 2. Database Schema

### A. Staging Tables (The "Inbox")
*These tables hold the raw data before it becomes valid bookings.*

1.  **`import_batches`**
    *   **Purpose**: Tracks a single file upload session.
    *   **Columns**: `id`, `hotel_id`, `filename`, `status` (uploaded, processing, completed, failed), `total_rows`.

2.  **`import_rows`**
    *   **Purpose**: Stores individual rows from the CSV.
    *   **Columns**: 
        *   `batch_id`: Links to the batch.
        *   `raw_data`: Full JSON of the CSV row.
        *   `parsed_data`: Cleaned/mapped JSON (after API processing).
        *   `status`: `pending` -> `processing` -> `completed` (or `failed`) -> `notified`.
        *   `error`: detailed error message if validation fails.

### B. Core Business Tables
1.  **`bookings`**
    *   **Purpose**: The source of truth for reservations.
    *   **Enhancements**:
        *   `precheckin_reminder1_sent_at`: Timestamp for T-1 day reminder.
        *   `precheckin_reminder2_sent_at`: Timestamp for Arrival Morning reminder.

2.  **`precheckin_tokens`**
    *   **Purpose**: Secure, unique tokens for guest access.
    *   **Columns**: `booking_id`, `token` (secure random string), `expires_at`.
    *   **Constraints**: Unique per booking.

3.  **`notification_queue`**
    *   **Purpose**: Async job queue for sending messages.
    *   **Columns**:
        *   `booking_id`: Target booking.
        *   `channel`: 'whatsapp' or 'email'.
        *   `template_code`: 'precheckin_link', 'precheckin_reminder_1', etc.
        *   `status`: `pending` -> `processing` -> `sent` (or `failed`).
        *   `retry_count`, `next_attempt_at`: For robustness.
    *   **Unique Index**: `(booking_id, template_code, channel)` prevents duplicate messages.

---

## 3. Detailed Data Flow

### Step 1: Upload (Frontend -> API)
1.  User maps columns in UI and clicks "Import".
2.  Frontend streams the CSV to **`upload-import-csv`** Edge Function.
3.  **Function Logic**:
    *   Creates a new `import_batch`.
    *   Parses the CSV stream.
    *   Inserts rows into `import_rows` with status `pending`.
    *   Returns success immediately (UI shows "Processing").

### Step 2: Processing (Worker: `process-import-rows`)
*Triggered every minute via `pg_cron`.*

1.  **Fetch**: Calls `fetch_pending_rows` RPC to get a batch of `pending` rows (uses `SKIP LOCKED` for concurrency safety).
2.  **Loop**: For each row:
    *   **Validate**: Checks required fields (Name, Check-in/out).
    *   **Upsert Booking**: Inserts or Updates `bookings` table (Idempotent on `booking_reference`).
    *   **Generate Token**: Calls `create_precheckin_token` RPC.
        *   Generates secure random bytes.
        *   Stores in `precheckin_tokens`.
        *   Handles race conditions.
    *   **Queue Notification**:
        *   Logic: If Phone exists -> Channel `'whatsapp'`. Else if Email -> Channel `'email'`.
        *   Inserts into `notification_queue` with status `pending`.
    *   **Update Row**: Sets `import_rows.status` to `notified`.

### Step 3: Delivery (Worker: `send-notifications`)
*Triggered every minute via `pg_cron`.*

1.  **Fetch**: Calls `fetch_pending_notifications` RPC.
2.  **Loop**: For each job:
    *   **WhatsApp**:
        *   Checks `WHATSAPP_TOKEN` and hotel's `wa_phone_number_id`.
        *   Sends template message via Facebook Graph API.
    *   **Email**:
        *   Checks `RESEND_API_KEY`.
        *   Sends HTML email via Resend API.
            *   *Fallback*: Guest name defaults to "Valued Guest" if missing.
    *   **Result**:
        *   Success: Marks as `sent`.
        *   Failure: Increments `retry_count`, sets `next_attempt_at` (+5 mins), wraps error as `notification_send_failed`.

---

## 4. Automated Reminder System

### Worker: `generate-reminders`
*Triggered every 30 minutes via `pg_cron`.*

This worker calls the **`generate_precheckin_reminders`** RPC, which handles the logic purely in SQL for maximum speed and safety.

### Logic (Inside RPC)
It runs two atomic operations using CTEs (Common Table Expressions):

#### A. T-1 Day Reminder
*   **Target**: Bookings with `checkin_date = tomorrow` AND `status` != 'CHECKED_IN'.
*   **Action**:
    *   Selects Bookings.
    *   **Multi-Channel Logic**:
        *   If Phone exists -> Queue **WhatsApp**.
        *   If Email exists -> Queue **Email**.
        *   (If both exist -> Queues **BOTH**).
    *   Inserts into `notification_queue`.
    *   Updates `bookings.precheckin_reminder1_sent_at` = `NOW()`.

#### B. Arrival Morning Reminder
*   **Target**: Bookings with `checkin_date = today` AND `time > 6:00 AM` (Hotel Local Time).
*   **Action**: Same multi-channel insert and update logic.

### Safety Features
1.  **Atomic Locks**: Uses `FOR UPDATE` to prevent race conditions during execution.
2.  **Idempotency**: `WHERE reminder_sent_at IS NULL` ensures we never double-process.
3.  **Duplicate Protection**: Database Index `(booking_id, template, channel)` physically rejects duplicates.
4.  **Timezone Aware**: All date checks use `AT TIME ZONE h.timezone` (e.g., Guest in Tokyo gets reminder at 6 AM Tokyo time).

---

## 5. Summary of Files

| Logic Layer | File Path |
| :--- | :--- |
| **Schema** | `supabase/migrations/stays/20260212_csv_import_schema.sql` |
| **Runtime** | `supabase/migrations/stays/20260215_production_import_runtime.sql` |
| **Reminders** | `supabase/migrations/stays/20260215_precheckin_reminders.sql` |
| **Scheduling** | `supabase/migrations/stays/20260215_schedule_import_workers.sql` |
| **Upload API** | `supabase/functions/upload-import-csv/index.ts` |
| **Process API** | `supabase/functions/process-import-rows/index.ts` |
| **Notify API** | `supabase/functions/send-notifications/index.ts` |
| **Remind API** | `supabase/functions/generate-reminders/index.ts` |
