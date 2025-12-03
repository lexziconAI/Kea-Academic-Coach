# LOG³×LOG⁴ DIAGNOSTIC: Persistent Listening Crisis

**Date:** December 4, 2025  
**Issue:** System stuck in "listening" state forever at session start. Send Now button doesn't work.  
**Status:** 🔴 CRITICAL - Blocking all user interactions

---

## LOG³ ANALYSIS: Problem × Root Cause × Impact

### Dimension 1: PROBLEM SPACE
- **Symptom**: System listens indefinitely without processing audio
- **User Action**: "Send Now" button click has no effect
- **System State**: Stuck in listening mode, no state transitions
- **Trigger**: Occurs from session start, even before any speech

### Dimension 2: ROOT CAUSE SPACE
**Primary Suspects:**
1. **Button State Initialization**: `manualSendMode` variable scoped inside `startRecording()`, not accessible to button click handlers
2. **Timing Race Condition**: Buttons rendered but event listeners attached before `audioGate` exists
3. **Audio Gate State**: Never initialized or in wrong state at start
4. **WebSocket Handshake**: Missing initial greeting trigger

### Dimension 3: IMPACT SPACE
- **User Experience**: Complete blocking failure - system unusable
- **Business Impact**: Production deployment failing, cannot demo
- **Technical Debt**: Manual mode feature introduced regression
- **Trust Impact**: Users lose confidence in voice interaction

---

## LOG⁴ ANALYSIS: Architecture × Timing × State × Control Flow

### Dimension 1: ARCHITECTURAL INTEGRATION
**Current Architecture:**
```
startRecording() [Line 1819]
  ├─ Creates audioContext
  ├─ Loads audio worklet
  ├─ Initializes AudioGate [Line 1867]
  │   ├─ let manualSendMode = false [Line 1857] ❌ LOCAL SCOPE
  │   ├─ onSilenceDetected handler [Line 1873]
  │   └─ onSpeechComplete handler [Line 1882]
  ├─ Button event listeners [Line 1931, 1942]
  │   ├─ extendBtn.addEventListener [Line 1931]
  │   └─ sendBtn.addEventListener [Line 1942]
  └─ Connects WebSocket [Line 2021]
```

**Critical Flaw:**
`manualSendMode` is declared INSIDE `startRecording()` function scope (line 1857), making it a closure variable. When buttons are clicked, they reference this closure, BUT the variable gets reset every time if there's any re-initialization.

### Dimension 2: TIMING ANALYSIS
**Expected Flow:**
1. User clicks mic button → `startRecording()`
2. WebSocket opens → Server sends initial greeting
3. `audio_chunk` arrives → `playAudioChunk()` → `updateState('speaking')`
4. Audio finishes → `updateState('listening')`
5. User speaks → AudioGate detects silence → Auto-send

**Actual Flow (BUG):**
1. User clicks mic button → `startRecording()`
2. WebSocket opens → ✅ OK
3. Initial greeting arrives → ❓ Does it arrive?
4. System goes to listening → ✅ OK
5. User speaks → AudioGate buffer fills → ❓ Silence detection?
6. User clicks "Send Now" → ❌ **NOTHING HAPPENS**

**Root Cause:** Send Now button tries to call `audioGate.forceFlush()` (line 1956), but either:
- `audioGate` is null/undefined
- `forceFlush()` doesn't exist
- Audio gate is in wrong state

### Dimension 3: STATE MACHINE ANALYSIS
**State Variables:**
- `isSystemSpeaking` [Global] ✅
- `isRecording` [Global] ✅
- `manualSendMode` [Local to startRecording] ❌ **SCOPE BUG**
- `pendingAudio` [Local to startRecording] ❌ **SCOPE BUG**
- `audioGate` [Global] ✅ (but might not be initialized)

**State Transitions:**
```
idle → listening → silence-pending → processing → speaking → listening
  ↑                                                              ↓
  └──────────────────────────────────────────────────────────────┘
```

**Missing Transitions:**
- `listening` → `processing` (when Send Now clicked)
- `silence-pending` → `listening` (when Keep Listening clicked)

### Dimension 4: CONTROL FLOW RED TEAM
**Attack Vector 1: Send Now at session start**
```javascript
// Line 1942: sendBtn.addEventListener('click', () => {
//   Line 1956: audioGate.forceFlush()
```
❌ **If no speech captured yet, audioGate buffer is empty → forceFlush() does nothing**

**Attack Vector 2: Keep Listening before any speech**
```javascript
// Line 1931: extendBtn.addEventListener('click', () => {
//   Line 1937: audioGate.disableAutoSend()
```
❌ **If audioGate isn't initialized, this crashes silently**

**Attack Vector 3: Rapid button clicks**
```javascript
// No debouncing on button clicks
// No state check before button actions
```
❌ **Can trigger multiple simultaneous operations**

---

## CANONICAL VERSION COMPARISON

**What Changed:**
1. **Commit SHA:** Unknown (need to find)
2. **Feature Added:** Persistent "Keep Listening" and "Send Now" buttons (visible from start)
3. **Before:** Buttons only appeared during `silence-pending` state
4. **After:** Buttons always visible, flash during silence

**Key Differences:**
```diff
- BEFORE: Buttons conditional on audioGate state
+ AFTER: Buttons always visible

- BEFORE: manualSendMode didn't exist
+ AFTER: manualSendMode controls auto-send behavior

- BEFORE: Simple silence timeout → auto-send
+ AFTER: Complex manual mode + auto mode toggle
```

**What Broke:**
The buttons were added to the DOM BEFORE the audioGate exists, and the event listeners assume audioGate is ready. Additionally, `manualSendMode` being local scope means it can't be debugged or traced.

---

## SOLUTION MATRIX (LOG³ Selection)

### Option 1: SCOPE FIX (Immediate Fix)
**Move variables to global scope:**
```javascript
// BEFORE (Line 1857):
let manualSendMode = false; // Inside startRecording()

// AFTER:
let manualSendMode = false; // Global scope
let pendingAudio = null;    // Global scope
let pendingDuration = 0;    // Global scope
```

**Pros:** Simple, preserves all functionality  
**Cons:** More global state (but already using globals)  
**Confidence:** 95%

### Option 2: DEFENSIVE CHECKS (Hardening)
**Add null checks in button handlers:**
```javascript
sendBtn.addEventListener('click', () => {
    if (!audioGate) {
        console.error('[BUG] audioGate not initialized!');
        return;
    }
    if (!isRecording) {
        console.error('[BUG] Not recording!');
        return;
    }
    // ... rest of logic
});
```

**Pros:** Prevents crashes, gives diagnostic info  
**Cons:** Doesn't fix root cause  
**Confidence:** 80%

### Option 3: STATE MACHINE REFACTOR (Long-term)
**Create formal state machine class:**
```javascript
class VoiceSessionState {
    constructor() {
        this.state = 'idle';
        this.manualMode = false;
        this.pendingAudio = null;
    }
    
    transition(newState) { /* ... */ }
    canSendNow() { /* ... */ }
    canKeepListening() { /* ... */ }
}
```

**Pros:** Bulletproof, testable, maintainable  
**Cons:** Major refactor, high risk  
**Confidence:** 60% (risk of introducing new bugs)

---

## RECOMMENDED FIX (IMMEDIATE)

**Apply Options 1 + 2 in combination:**

1. **Move scope bugs to global** (fixes Send Now not working)
2. **Add defensive checks** (prevents future crashes)
3. **Add debug logging** (helps diagnose in production)

**Changes Required:**
- Move `manualSendMode`, `pendingAudio`, `pendingDuration` to global scope
- Add null checks in button click handlers
- Add console logging for button clicks
- Test: Click "Send Now" at session start (should see diagnostic message)

---

## TESTING CHECKLIST

**Scenario 1: Send Now at session start**
- [ ] Click mic button
- [ ] Wait for greeting
- [ ] Click "Send Now" immediately (no speech)
- **Expected:** Diagnostic message or graceful no-op
- **Current:** Nothing happens (broken)

**Scenario 2: Keep Listening during speech**
- [ ] Start speaking
- [ ] Wait for silence flash
- [ ] Click "Keep Listening"
- **Expected:** Continue recording, no auto-send
- **Current:** Unknown (probably broken)

**Scenario 3: Send Now with buffered audio**
- [ ] Start speaking
- [ ] Wait for silence flash
- [ ] Click "Send Now"
- **Expected:** Immediate send, system processes
- **Current:** Unknown (probably broken)

**Scenario 4: Normal auto-send (don't click anything)**
- [ ] Start speaking
- [ ] Wait for silence flash
- [ ] Wait 1100ms more
- **Expected:** Auto-send, system responds
- **Current:** Works? (need to verify)

---

## ROOT CAUSE SUMMARY

**The Chatbot Trap Part 2:**
Just like the "Open Notepad" failure where the AI said it would do something but didn't call the tool, here we have UI buttons that LOOK like they work but don't actually connect to the underlying system state.

**The Real Bug:**
Variable scope issue + missing null checks + timing race condition = perfect storm of failure.

**The Fix:**
Move variables to proper scope, add defensive programming, test all edge cases.

---

**Confidence in Diagnosis:** 90%  
**Confidence in Fix:** 95%  
**Estimated Fix Time:** 15 minutes  
**Risk Level:** LOW (scope change is low risk, defensive checks add safety)

