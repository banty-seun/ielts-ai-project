# IELTS AI Companion - System Architecture Guide

## Overview

IELTS AI Companion is a full-stack web application designed to help users prepare for the IELTS exam with a focus on Canadian immigration. The application uses AI-powered personalized learning plans, audio generation capabilities, and comprehensive progress tracking to provide an interactive learning experience.

## Recent Changes (January 28, 2025)

**Practice Page Consolidation and Audio Playback Fix (January 28, 2025)**
- **COMPLETE PRACTICE PAGE REWRITE**: Eliminated all legacy code paths and mock data
- Removed exerciseSets, currentExercise, complex audio pipelines, blob/objectURL resolution
- Simplified to single source of truth: useTaskContent and useTaskProgress hooks only
- Implemented direct S3 audio URLs with simple HTML5 player (no CORS/probe/retry complexity)
- Added DEBUG toggle for clean logging hygiene (no render-loop spam)
- Established title precedence: scenario+conversationType → API title → route param → fallback
- Added proper loading, error, and empty states with no mock fallbacks
- **S3 AUDIO ACCESS CONFIRMED**: Successfully regenerated failing audio with SSE-S3 encryption
- Audio URL tested: 200 OK, 626KB MP3, direct browser playback ready
- Fixed bucket access patterns for seamless audio streaming

**Backend Content Generation Pipeline Completion**
- Implemented missing question generation functionality using OpenAI GPT-4o Mini
- Added generateQuestionsFromScript() function that creates 4-5 IELTS listening questions per script
- Enhanced audio generation error logging to debug silent failures
- Fixed TypeScript schema alignment for question data structure (options as objects with id/text)
- Integrated question generation into task content API pipeline: Script → Questions → Audio
- **CRITICAL FIX: Updated pipeline trigger condition** from title-based keyword matching to skill-based detection
- Added 'skill' field to task progress schema with proper database migration
- Updated task creation flow to include skill='listening' for deterministic content generation
- **PIPELINE COMPLETION FIX: Restructured 3-stage pipeline execution**
  - Stage 1: Script generation (if missing)
  - Stage 2: Question generation (if scriptText exists but questions missing)
  - Stage 3: Audio generation (if scriptText exists but audioUrl missing)
  - Each stage runs independently with comprehensive logging
  - Removed conditional logic that prevented questions/audio generation when script existed
- **AWS POLLY STREAM FIX: Fixed critical Node.js streaming incompatibility**
  - Replaced Web Streams API (.getReader()) with Node.js stream methods (.on('data'))
  - Fixed "stream.getReader is not a function" error that blocked audio generation
  - Added comprehensive stream processing logging and S3 upload validation
  - Audio pipeline now properly converts Polly streams to buffers for S3 storage
- The Practice component now receives complete task content instead of null questions/audio

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

The application follows a modern full-stack architecture with clear separation between client and server components:

- **Frontend**: React with TypeScript, Vite build system
- **Backend**: Express.js server with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Firebase Authentication with custom middleware
- **Styling**: Tailwind CSS with shadcn/ui components
- **External Services**: AWS Polly for audio generation, AWS S3 for file storage, OpenAI for content generation

## Key Components

### Frontend Architecture
- **React Application**: Single-page application with component-based architecture
- **State Management**: React Query for server state, React Context for auth state
- **Routing**: Wouter for client-side routing
- **UI Framework**: shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with custom theme configuration
- **Build Tool**: Vite with TypeScript support

### Backend Architecture
- **Express Server**: RESTful API with TypeScript
- **Authentication**: Firebase Admin SDK for token verification
- **Database Layer**: Drizzle ORM with PostgreSQL
- **File Structure**: Modular controller-based API design
- **Middleware**: Custom Firebase auth middleware for protected routes

### Database Schema
The application uses PostgreSQL with the following main entities:
- **Users**: Authentication and profile data (supports both Firebase UID and Google ID)
- **Study Plans**: AI-generated personalized learning plans
- **Weekly Study Plans**: Detailed weekly task breakdowns
- **Task Progress**: Individual task completion tracking
- **Sessions**: Session storage for authentication

### Authentication System
- **Primary**: Firebase Authentication for email/password and Google OAuth
- **Fallback**: Replit authentication system for development
- **Token Management**: Custom token manager with caching and refresh logic
- **Authorization**: Route-level protection with onboarding status checks

## Data Flow

1. **User Registration/Login**: Firebase handles authentication, creates user record in PostgreSQL
2. **Onboarding**: Collects user preferences and generates personalized study plan via OpenAI
3. **Dashboard**: Displays weekly plans with task progress tracking
4. **Practice Sessions**: 
   - Loads task content from database
   - Generates audio via AWS Polly if needed
   - Tracks progress and completion
5. **Content Generation**:
   - Scripts generated via OpenAI GPT-4
   - Audio synthesized via AWS Polly Neural voices
   - Files stored in AWS S3
   - Metadata updated in database

## External Dependencies

### AI and Content Generation
- **OpenAI API**: GPT-4 for generating personalized study plans and listening scripts
- **AWS Polly**: Neural text-to-speech for audio generation (supports multiple accents)
- **AWS S3**: Cloud storage for generated audio files

### Authentication and Database
- **Firebase**: Authentication services (email/password, Google OAuth)
- **Neon Database**: PostgreSQL hosting for production
- **Drizzle ORM**: Type-safe database operations

### Communication
- **SendGrid**: Email service for notifications and verification

### Development Tools
- **Vite**: Fast development server and build tool
- **React Query**: Server state management and caching
- **Framer Motion**: Animations and transitions

## Deployment Strategy

The application is designed for deployment on Replit with the following configuration:

- **Development**: Local Vite dev server with hot module replacement
- **Production**: Express server serving built React application
- **Database**: External PostgreSQL (Neon) with connection pooling
- **Environment Variables**: Secure configuration for all external services
- **Build Process**: Vite builds frontend, esbuild bundles backend

### Key Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `OPENAI_API_KEY`: OpenAI API access
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: AWS services
- `FIREBASE_*`: Firebase configuration
- `SENDGRID_API_KEY`: Email service

### Performance Optimizations
- Firebase operation tracking and quota management
- Request-level token caching to reduce auth overhead
- Batch database operations for task initialization
- Pre-generation of content during plan creation
- Component-level error boundaries and loading states

The architecture prioritizes scalability, maintainability, and user experience while ensuring secure handling of sensitive data and efficient resource utilization.