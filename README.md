# PassGate

PassGate is a React + Vite browser preview for student registration, identification cards, and centre entry check-in.

## Run locally

Requires Node.js 20.19+ and npm.

```sh
npm install
npm run dev
```

Vite prints a local URL to open in a browser. Use `npm run build` to create the production bundle and `npm run preview` to serve that bundle locally.

The preview saves student records, attendance, centre name, logo, and demo staff accounts in this browser's local storage. Data is isolated by browser origin and is not shared between staff devices. The role-based sign-in is a UI prototype only: names and numbers are not passwords, and browser-side access checks can be bypassed. Do not store real student or staff data in this preview.

## Included in this first build

- Student registration with sequential PassGate IDs in `PG-YY-######` format.
- Student ID card preview and physical card printing at CR80 aspect ratio.
- A unique QR code for each student. The QR payload is that student's own PassGate ID number.
- Centre name and optional logo settings for card branding.
- Manual gate lookup, visual photo verification, and duplicate check-in prevention.
- Daily attendance view and student/attendance CSV exports.
- Dashboard cards, a weekly check-in graph, and sample timetable cards.
- Role-based preview access for Security, Teacher, and Admin. Security can view student and gate information; Teacher sees the schedule; Admin can create staff accounts and update centre branding. The first run creates the initial Admin account.
- React UI, Vite development server, and a production build.

## Follow-on work

The Supabase backend described in `PassGate-MVP-Blueprint.md` is not connected yet. Next steps are Supabase Auth, PostgreSQL migrations and row-level security, private photo storage, camera-based QR scanning, editable class/timetable management, and production deployment. Enforce role permissions on the server before production. The sample timetable and account store are illustrative; accounts, shared centre data, and server-side ID allocation are not implemented in this local preview.
