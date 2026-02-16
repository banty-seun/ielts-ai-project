# Listening Module Sequence Diagram

This document captures the interaction sequence across `User`, `App`, `Orchestrator`, `Agents`, and `TTS` for the listening workflow.

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant App
    participant Orchestrator
    participant TutorAgent
    participant ScriptAgent
    participant QuestionAgent
    participant TTS
    participant PerfCoach

    User->>App: Complete onboarding
    App->>TutorAgent: Generate weekly listening plan (profile, goals, level)
    TutorAgent-->>App: Weekly plan (4 sections, targets, accents)
    App->>Orchestrator: Create listening session job

    loop Sections processed sequentially (Part 1 -> Part 4)
        Orchestrator->>ScriptAgent: Generate section blueprint + 3 linked scripts
        ScriptAgent-->>Orchestrator: Scripts A/B/C + accent plan
        Orchestrator->>QuestionAgent: Generate 3 question blocks (JSON config)
        QuestionAgent-->>Orchestrator: Question blocks + answer keys
        Orchestrator->>TTS: Render audio for scripts with accent profile
        TTS-->>Orchestrator: Audio asset URLs + durations
        Orchestrator->>Orchestrator: Validate schema, anchors, timings, keys
        Orchestrator-->>App: Publish section package (questions + audio + metadata)
    end

    App-->>User: Part 1 ready, start listening test
    loop Each part attempt
        User->>App: Submit answers + playback interactions
        App->>App: Score part + persist response/timing metadata
        App-->>User: Show per-part result page
    end

    User->>App: Submit full test
    App->>PerfCoach: Analyze scores, response patterns, timing, metadata
    PerfCoach-->>App: Personalized strategies + challenge tags + next practice set
    App-->>User: Final personalized report
    App->>TutorAgent: Feed weaknesses for next weekly plan update
```

## Flow Summary

1. User onboarding data is converted into a weekly listening plan by the Tutor Agent.
2. App starts a session orchestration job.
3. Orchestrator processes sections in strict sequence (`Part 1 -> Part 2 -> Part 3 -> Part 4`).
4. For each section, Script Agent and Question Agent generate content, then TTS renders audio.
5. Orchestrator validates and publishes each section package.
6. User completes each part and receives per-part result pages.
7. At final submission, Performance Coach generates personalized strategies, challenge diagnosis, and recommended next practice set.
8. Weakness signals are fed back to Tutor Agent for next-week adaptation.
