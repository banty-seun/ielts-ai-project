# Listening Practice Session System Documentation

## Overview

This document describes the new session-based listening practice system that provides a robust, time-aware, and user-friendly experience for IELTS listening practice.

## Architecture

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                     User Dashboard                           │
│              (ListeningWeeklyPlan.tsx)                       │
└───────────────────────┬─────────────────────────────────────┘
                        │ Click task
                        ↓
┌─────────────────────────────────────────────────────────────┐
│            Session Route (/listening-session)                │
│              (listening-session.tsx)                         │
│   - Initializes/resumes session state                        │
│   - Handles authentication                                   │
└───────────────────────┬─────────────────────────────────────┘
                        │ Passes sessionState
                        ↓
┌─────────────────────────────────────────────────────────────┐
│         ListeningPracticeSession Component                   │
│         (ListeningPracticeSession.tsx)                       │
│   - Main practice UI                                         │
│   - Audio player, questions, feedback                        │
│   - Uses useListeningSession hook                            │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────────────┐
│            useListeningSession Hook                          │
│           (useListeningSession.ts)                           │
│   - Session state management                                 │
│   - Pause/resume with server sync                            │
│   - Auto-advance logic                                       │
│   - Uses useSessionTimer for drift-free timing               │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────────────┐
│              useSessionTimer Hook                            │
│            (useSessionTimer.ts)                              │
│   - Drift-resistant timing using performance.now()          │
│   - Accurate elapsed/remaining time tracking                 │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

### Client-Side

```
client/src/
├── components/
│   ├── dashboard/
│   │   ├── ListeningWeeklyPlan.tsx      # Updated with session navigation
│   │   └── ListeningTaskCard.tsx         # Enhanced with session state UI
│   └── practice/
│       ├── ListeningPracticeSession.tsx  # Main session component
│       ├── AdvisorFeedback.tsx           # AI feedback display
│       └── SessionSummary.tsx            # Session results summary
├── hooks/
│   ├── useListeningSession.ts            # Session management hook
│   └── useSessionTimer.ts                # Drift-free timer hook
└── pages/
    └── listening-session.tsx             # Session page route
```

### Server-Side

```
server/
├── routes.ts                             # Session API endpoints
│   ├── POST /api/session/start           # Start new session
│   ├── POST /api/session/pause           # Pause session
│   ├── POST /api/session/resume          # Resume session
│   ├── POST /api/session/sync            # Sync session state
│   ├── GET  /api/session/sync            # Get session state
│   ├── POST /api/session/advisor         # Get AI feedback
│   └── POST /api/session/next-listening-task  # Generate next audio
├── openai.ts                             # AI generation functions
└── storage.ts                            # Database operations
```

### Shared

```
shared/
└── schema.ts                             # TypeScript types
    ├── SessionState                      # Session state interface
    ├── SessionStatus                     # Status enum
    ├── SessionResult                     # Results interface
    └── AdvisorFeedback                   # Feedback interface
```

## Key Features

### 1. Drift-Resistant Timing

**Problem**: JavaScript's `setInterval` and `setTimeout` accumulate drift over time, leading to inaccurate session timing.

**Solution**: `useSessionTimer` uses `performance.now()` to track actual elapsed time, preventing drift accumulation.

```typescript
// useSessionTimer.ts
const now = performance.now();
const actualElapsed = now - startTimeRef.current;
const totalElapsed = accumulatedRef.current + actualElapsed;
```

### 2. Pause/Resume with Server Sync

**Problem**: Users need to pause sessions without losing progress, and state must persist across page refreshes.

**Solution**: Session state is stored server-side and synced automatically every 30 seconds (configurable).

```typescript
// useListeningSession.ts
const pause = async () => {
  const consumedMs = sessionState.consumedMs + elapsed;
  await syncWithServer(consumedMs, 'paused');
};
```

### 3. Auto-Advance Logic

**Problem**: If a user finishes an audio with time remaining, they should automatically get the next audio without manual intervention.

**Solution**: After each audio submission, check if there's enough time (5+ minutes) for another audio and request a top-up from the server.

```typescript
// ListeningPracticeSession.tsx
if (canAutoAdvance && remaining > 5 * 60 * 1000) {
  const nextResult = await requestNextAudio();
  if (nextResult.ok) {
    setCurrentAudio(nextResult.audio);
  }
}
```

### 4. AI Advisor Feedback

**Problem**: Users need actionable feedback after each audio to improve their listening skills.

**Solution**: After submitting answers, call `/api/session/advisor` to get personalized feedback from GPT-4o-mini.

```typescript
// useListeningSession.ts
const result = await submitAudio(answers, audioIndex);
if (result.feedback) {
  setFeedback(result.feedback);
}
```

### 5. Session Completion Summary

**Problem**: Users need a clear, motivating summary of their performance when the session ends.

**Solution**: `SessionSummary` component displays overall score, per-audio breakdown, time spent, and AI highlights.

## API Endpoints

### POST /api/session/start

**Purpose**: Initialize a new listening practice session

**Request**:
```json
{
  "taskId": "uuid-of-task-progress"
}
```

**Response**:
```json
{
  "success": true,
  "sessionState": {
    "status": "running",
    "durationMinutes": 30,
    "startedAt": 1234567890,
    "consumedMs": 0,
    "remainingMs": 1800000,
    "currentAudioIndex": 0,
    "prefetchedAudios": [...]
  }
}
```

### POST /api/session/pause

**Purpose**: Pause the current session

**Request**:
```json
{
  "taskId": "uuid",
  "consumedMs": 120000
}
```

**Response**:
```json
{
  "success": true,
  "sessionState": {
    "status": "paused",
    "remainingMs": 1680000,
    ...
  }
}
```

### POST /api/session/resume

**Purpose**: Resume a paused session

**Request**:
```json
{
  "taskId": "uuid"
}
```

**Response**:
```json
{
  "success": true,
  "sessionState": {
    "status": "running",
    "startedAt": 1234567950,
    ...
  }
}
```

### GET /api/session/sync

**Purpose**: Get current session state (for resuming after page refresh)

**Query Params**: `taskId=uuid`

**Response**:
```json
{
  "success": true,
  "sessionState": { ... }
}
```

### POST /api/session/advisor

**Purpose**: Get AI feedback for a completed audio

**Request**:
```json
{
  "audioIndex": 0,
  "questions": [
    {
      "questionId": "q1",
      "question": "What is...",
      "correctAnswer": "optionA",
      "selectedAnswer": "optionB"
    }
  ],
  "scriptExcerpt": "Audio transcript excerpt..."
}
```

**Response**:
```json
{
  "success": true,
  "scoreText": "7/10",
  "summary": "You demonstrated strong...",
  "actions": [
    "Focus on numbers and dates",
    "Practice identifying speaker roles",
    "Review synonym recognition"
  ]
}
```

### POST /api/session/next-listening-task

**Purpose**: Generate and prefetch the next audio (audio top-up)

**Request**:
```json
{
  "progressId": "uuid",
  "taskId": "uuid",
  "remainingMs": 900000
}
```

**Response**:
```json
{
  "ok": true,
  "audio": {
    "audioUrl": "https://...",
    "questions": [...],
    "scriptText": "...",
    "replayLimit": 3
  }
}
```

Or if insufficient time:
```json
{
  "ok": false,
  "reason": "time_exhausted"
}
```

## Database Schema

### SessionState (stored in taskProgress.progressData.sessionState)

```typescript
interface SessionState {
  status: "running" | "paused" | "completed" | "expired";
  durationMinutes: number;           // Total session duration
  startedAt?: number;                // Epoch ms when started/resumed
  pausedAt?: number;                 // Epoch ms when paused
  consumedMs: number;                // Total active time consumed
  remainingMs: number;               // Server-calculated remaining time
  currentAudioIndex: number;         // 0-based index in prefetched list
  prefetchedAudios?: AudioPackage[]; // Prefetched audio packages
  sessionResult?: SessionResult;     // Set when completed/expired
  readyForStrike?: boolean;          // True when complete (for XP)
  lastSyncedAt?: number;             // Last server sync timestamp
}
```

### SessionResult

```typescript
interface SessionResult {
  completedAt: number;              // Epoch ms
  usedMs: number;                   // Actual time spent
  scoreOverall: number;             // 0.0 to 1.0 (e.g., 0.75 = 75%)
  audios: SessionAudioResult[];     // Per-audio breakdown
  advisorHighlights: string[];      // AI feedback bullets
}

interface SessionAudioResult {
  index: number;
  correct: number;
  total: number;
  timeSpentMs?: number;
}
```

## User Flows

### Starting a New Session

1. User clicks a "not-started" task in `ListeningWeeklyPlan`
2. `handleTaskClick` navigates to `/listening-session?progressId=xxx`
3. `listening-session.tsx` calls `/api/session/start`
4. Server generates/fetches initial audio package
5. Server creates `SessionState` with status="running"
6. Client receives state and renders `ListeningPracticeSession`
7. `useListeningSession` starts drift-free timer
8. Auto-sync begins (every 30s)

### Resuming a Paused Session

1. User clicks a task with `sessionState.status="paused"`
2. Navigates to `/listening-session?progressId=xxx`
3. `listening-session.tsx` calls `/api/session/sync`
4. Server returns existing `SessionState`
5. Client renders with "Resume" button
6. User clicks Resume
7. `useListeningSession.resume()` calls `/api/session/resume`
8. Timer resumes from remaining time

### Completing an Audio

1. User answers all questions
2. Clicks "Submit Answers"
3. `ListeningPracticeSession` calls `submitAudio()`
4. `useListeningSession.submitAudio()` makes two requests:
   - `/api/session/advisor` for AI feedback
   - Moves to next audio if available, or requests top-up
5. If `canAutoAdvance && remaining > 5min`:
   - Call `/api/session/next-listening-task`
   - Server generates new audio in background
   - Returns immediately with new audio package
6. Display `AdvisorFeedback` component
7. Auto-advance to next audio

### Session Expiry (Time Runs Out)

1. `useSessionTimer` detects `elapsed >= duration`
2. Calls `onComplete` callback
3. `useListeningSession` syncs with server: status="expired"
4. Server marks session complete, calculates `SessionResult`
5. Client displays `SessionSummary` component
6. User can review performance and return to dashboard

## Configuration

### Timing Constants

```typescript
// shared/constants.ts
export const DEFAULT_SESSION_MINUTES = 30;
export const NEXT_MIN_MS = 5 * 60 * 1000; // 5 minutes minimum for next audio
export const SYNC_INTERVAL_MS = 30 * 1000; // 30 seconds auto-sync
```

### Customization

Users can customize session duration via onboarding preferences:

```typescript
// Onboarding preferences
listeningDurations: {
  weekday: 20,  // 20 minutes on weekdays
  weekend: 45,  // 45 minutes on weekends
}
```

## UI Components

### ListeningTaskCard Enhancements

Shows visual indicators for session state:

- **Running**: Blue border with pulse animation, "Active" badge
- **Paused**: Yellow border, "Paused" badge
- **Completed**: Green border, checkmark, score display

Displays session info:
- Current audio index (e.g., "Audio 2/5")
- Time remaining (e.g., "15m 30s remaining")

### AdvisorFeedback Component

Color-coded sections:
- **Green**: Praise and encouragement
- **Blue**: Progress summary
- **Purple**: Actionable suggestions
- **Indigo**: Next task preview

### SessionSummary Component

- Trophy icon with performance-based color
- Overall score (large, prominent)
- Time spent breakdown
- Per-audio performance cards
- AI advisor highlights
- "Continue" button to return to dashboard

## Testing

### Unit Tests (To Be Added)

```bash
# Test timer accuracy
npm test -- useSessionTimer.test.ts

# Test pause/resume logic
npm test -- useListeningSession.test.ts

# Test auto-advance conditions
npm test -- ListeningPracticeSession.test.ts
```

### Manual Testing Checklist

- [ ] Start a new session from dashboard
- [ ] Pause and resume session
- [ ] Refresh page during active session (should resume)
- [ ] Complete an audio with 10+ minutes remaining (should auto-advance)
- [ ] Complete an audio with <5 minutes remaining (should show summary)
- [ ] Let session timer expire naturally
- [ ] Test replay audio functionality
- [ ] Test AI advisor feedback display
- [ ] Test session summary on completion
- [ ] Test navigation back to dashboard

## Performance Considerations

### Client-Side

1. **Timer Updates**: 100ms interval (configurable)
   - Balance between accuracy and CPU usage
   - 100ms provides smooth countdown without excessive rendering

2. **Auto-Sync**: 30-second interval
   - Prevents data loss on unexpected page close
   - Not too frequent to avoid unnecessary network traffic

3. **Audio Prefetching**: Server generates 2-3 audios upfront
   - Reduces wait time between audios
   - Top-up generation happens in background

### Server-Side

1. **AI Generation**: Cached and parallelized
   - Script generation: ~3-5s (GPT-4)
   - Question generation: ~2-3s (GPT-4o-mini)
   - TTS generation: ~2-4s (AWS Polly)
   - Total: ~7-12s per audio (background)

2. **Database Writes**: Minimized
   - Only update on pause, resume, complete, sync
   - Use transaction for atomic updates

## Future Enhancements

### Planned Features

1. **Offline Support**
   - Cache audio files for offline playback
   - Queue state updates for sync when online

2. **Progress Analytics**
   - Track weak areas over time
   - Personalized difficulty adjustment

3. **Social Features**
   - Compare scores with friends
   - Weekly leaderboards

4. **Advanced Feedback**
   - Speech recognition for pronunciation practice
   - Video-based listening tasks

### Known Limitations

1. **Browser Compatibility**
   - Requires modern browser with `performance.now()` support
   - Audio element may behave differently across browsers

2. **Network Reliability**
   - Auto-sync fails silently if offline
   - Need offline indicators and retry logic

3. **Concurrent Sessions**
   - Current implementation assumes one active session per user
   - Multi-device sync not yet implemented

## Troubleshooting

### Session state not persisting after refresh

**Cause**: Server sync may have failed, or progressData not updated

**Solution**:
- Check server logs for `/api/session/sync` errors
- Verify `updateTaskProgress` is called with correct progressData
- Check browser console for network errors

### Timer showing incorrect time

**Cause**: Drift accumulation or incorrect initial state

**Solution**:
- Verify `useSessionTimer` is using `performance.now()`
- Check that `consumedMs` and `remainingMs` are synced properly
- Ensure timer resets correctly on pause/resume

### Auto-advance not working

**Cause**: Insufficient time remaining or server-side generation failure

**Solution**:
- Check `canAutoAdvance` condition (needs 5+ minutes)
- Verify `/api/session/next-listening-task` returns `ok: true`
- Check server logs for OpenAI/Polly errors

### AI feedback not showing

**Cause**: Request to `/api/session/advisor` failed

**Solution**:
- Check OpenAI API key and quota
- Verify question format matches expected structure
- Check for JSON parsing errors in server response

## Deployment

### Environment Variables

```bash
# Server
OPENAI_API_KEY=sk-...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1

# Client (Vite)
VITE_API_BASE_URL=https://api.example.com
```

### Build Commands

```bash
# Type check
npm run check

# Build client and server
npm run build

# Start production server
npm start
```

### Database Migrations

No new tables required. Session state stored in existing `taskProgress.progressData` JSONB field.

## Support

For questions or issues:
- GitHub Issues: [Repository URL]
- Email: support@example.com
- Documentation: [Docs URL]

---

**Last Updated**: 2025-10-30
**Version**: 1.0.0
**Author**: IELTS AI Team
