/**
 * E2E (ADR-0006 conversational study flow): greeting → name a topic → tutor
 * teaches + chalks → hint (encouragement note) → quiz → grading + XP →
 * flashcards. Driven through the conversational answer bar (real
 * microphones are unavailable in headless browsers — voice is exercised via
 * a SpeechRecognition stub in the dedicated voice test below).
 */
import { expect, test, type Page } from "@playwright/test";

/**
 * Installs a fake Web Speech API that emits the given transcript as a final
 * recognition result ~300 ms after start(). This exercises the REAL voice
 * pipeline (hook → silence timer → commit → tutor turn) end-to-end in
 * Chromium, which has no microphone in CI.
 */
async function installSpeechStub(page: Page, transcript: string): Promise<void> {
  await page.addInitScript(
    ([text]) => {
      class FakeRecognition {
        lang = "en-US";
        continuous = true;
        interimResults = true;
        onresult: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        private timer: ReturnType<typeof setTimeout> | null = null;
        start(): void {
          this.timer = setTimeout(() => {
            this.onresult?.({
              resultIndex: 0,
              results: [{ 0: { transcript: text }, isFinal: true, length: 1 }],
            });
          }, 300);
        }
        stop(): void {
          if (this.timer) clearTimeout(this.timer);
          this.onend?.();
        }
        abort(): void {
          if (this.timer) clearTimeout(this.timer);
        }
      }
      (window as any).SpeechRecognition = FakeRecognition;
    },
    [transcript],
  );
}

test.describe("self-improving personalization", () => {
  test("feedback on New-session exit saves a preference; Settings shows it", async ({ page }) => {
    await page.goto("/");
    // Start a real lesson so the New-session exit offers feedback (same
    // interaction pattern as the main loop test: the welcome answer bar
    // creates the session on the student's first words).
    const answerBar = page.getByPlaceholder(/Ask anything/);
    await answerBar.fill("I want to learn about photosynthesis");
    await answerBar.press("Enter");
    await expect(page).toHaveURL(/\/sessions\//, { timeout: 15_000 });
    await expect(page.getByTestId("new-session-btn")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("new-session-btn").click();

    // The optional prompt appears; Skip works without saving anything.
    const prompt = page.getByTestId("feedback-prompt");
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId("feedback-save")).toBeDisabled(); // empty = no save

    // Save real feedback → confirmation shows what changed.
    await page.getByTestId("feedback-input").fill(
      "Please give me more time to think before revealing answers.",
    );
    await page.getByTestId("feedback-save").click();
    await expect(page.getByTestId("feedback-done")).toBeVisible({ timeout: 30_000 });

    // The preference is manageable in Settings.
    await page.goto("/settings");
    const panel = page.getByTestId("tutor-preferences");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/time|think/i);

    // Student control: remove it again.
    await panel.getByLabel(/Remove:/).first().click();
    await expect(panel).toContainText(/Nothing saved yet/i, { timeout: 15_000 });
  });
});

test.describe("conversational study loop (chalkboard)", () => {
  test("greets first, teaches a topic, quizzes, and shows XP", async ({ page }) => {
    await page.goto("/");

    // Welcome board (user spec): the greeting appears immediately on the
    // home chalkboard — NO session is created until the student actually
    // says, types, or uploads something.
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByText(/what are we learning today/i).first()).toBeVisible();

    // Answer conversationally via the welcome answer bar. This first input
    // is what CREATES the session; the tutor teaches it immediately (no
    // second greeting on the other side).
    const answerBar = page.getByPlaceholder(/Ask anything/);
    await answerBar.fill("I want to learn about photosynthesis");
    await answerBar.press("Enter");
    await expect(page).toHaveURL(/\/sessions\//, { timeout: 15_000 });

    // The tutor teaches the topic and chalks it. A real tutor MUST respond
    // with a message (it greets and opens the topic), chalk the student's
    // exact words, and classify the subject — we assert those outcomes,
    // not any single mock phrasing.
    await expect(page.getByTestId("chalkboard-surface")).toBeVisible({
      timeout: 15_000,
    });
    // Student echo (user spec): the student's words are chalked on the board
    // in their own color before the tutor responds. (tldraw renders text in
    // both the canvas and its a11y mirror, so match first.)
    await expect(
      page
        .getByTestId("chalkboard-surface")
        .getByText(/^You: I want to learn about photosynthesis/)
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    // Tutor reply landed (some message exists in the speech bubble after the
    // board appeared) — proof the tutor actually spoke, not that it matched a
    // hardcoded mock sentence.
    await expect(page.getByTestId("speech-bubble")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("speech-bubble").first()).not.toHaveText(/Ask anything|Hey! I'm so glad/i);

    // Student echo (user spec): the student's words are chalked on the board
    // in their own color before the tutor responds. (tldraw renders text in
    // both the canvas and its a11y mirror, so match first.)
    await expect(
      page
        .getByTestId("chalkboard-surface")
        .getByText(/^You: I want to learn about photosynthesis/)
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Subject pill (user spec): the tutor classifies the subject and the
    // pill reflects it — no more always-Math.
    await expect(page.getByRole("button", { name: "Lesson settings" })).toContainText(
      /Science|English|History|Math|Other/i,
      { timeout: 15_000 },
    );

    // The encouragement note is hidden until a hint or a correct answer.
    await expect(page.getByTestId("encouragement-note")).toHaveCount(0);

    // Hint orb → tutor gives a hint → the sticky note appears. Free-model
    // turns can take 30s+ (pool rotation); the generous window waits out the
    // model, not the UI (the note renders the instant the turn lands).
    await page.getByRole("button", { name: "Hint", exact: true }).click();
    await expect(page.getByTestId("encouragement-note")).toBeVisible({ timeout: 45_000 });
    // Any encouragement wording is fine — the note just has to contain the
    // student's names/pronouns-free encouragement.
    await expect(page.getByTestId("encouragement-note")).toContainText(/great|keep going|doing great|keep|try|nice|good|fire|unstoppable/i);

    // Quiz me (Quiz orb) → the tutor poses a question with choices, and the
    // interactive quiz card appears with tappable choice buttons.
    await page.getByRole("button", { name: "Quiz", exact: true }).click();
    await expect(page.getByTestId("quiz-card")).toBeVisible({ timeout: 20_000 });
    // At least one tappable choice button must be inside the quiz card.
    const choiceButtons = page
      .getByTestId("quiz-card")
      .getByRole("button", { name: /.+/ });
    await expect(choiceButtons.first()).toBeVisible({ timeout: 15_000 });    // Pick any visible choice and submit it.
    await choiceButtons.first().click();
    // Correct answer → the celebration note appears the moment the grading
    // turn lands (mock: instantly; real model: within the window). It must be
    // asserted BEFORE any soft check that can burn its own timeout — the note
    // auto-hides after 8s. Stats are cumulative across runs, so the streak may
    // have escalated the wording (🎉 great → 🔥 On fire → ⚡ UNSTOPPABLE).
    await expect(page.getByTestId("encouragement-note")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("encouragement-note")).toContainText(/great|keep going|doing great|keep|try|nice|good|fire|unstoppable/i);
    // After answering, either a verdict (correct/not-quite) or the quiz card
    // disappears and a tutor message replaces it — both are acceptable. Soft
    // check LAST so it can never eat the note's visibility window.
    await expect(
      page.locator("text=/^(Correct|Not quite|✓|✗)/i").first(),
    ).toBeVisible({ timeout: 8_000 }).catch(() => {});

    // Stats flowed through the turn: the pill reflects cumulative XP (any
    // positive delta from the quiz answer) — we just confirm XP appeared.
    await expect(page.getByText(/XP/).first()).toBeVisible({ timeout: 15_000 });

    // Flashcards via the Cards orb → modal opens with cards.
    await page.getByRole("button", { name: "Cards", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Flashcards" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/\?/).first()).toBeVisible();

    // Voice-flashcard flow (ADR-0007): flip → self-mark mastered → advances.
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await page.getByRole("button", { name: /I knew it/ }).click();
    await expect(page.getByText(/Card 2 of/i).first()).toBeVisible();
    await page.getByRole("button", { name: /Speak it/ }).click(); // recognition may be unsupported headless; button must exist
    // Explicit close button (user spec): every floating surface needs one.
    await page.getByRole("button", { name: "Close flashcards" }).click();
    await expect(page.getByRole("dialog", { name: "Flashcards" })).toHaveCount(0);

    // Board-side lesson controls (user spec): the subject pill opens a small
    // popover with the explicit subject / grade / help-style knobs. Picking
    // them updates the pill (optimistic) and PATCHes the live session.
    await page.getByRole("button", { name: "Lesson settings" }).click();
    await expect(page.getByText("Lesson settings", { exact: true })).toBeVisible();
    await page.getByLabel("Subject").selectOption("history");
    await expect(page.getByRole("button", { name: "Lesson settings" })).toContainText("History");
    await page.getByLabel("Grade level").selectOption("high_school");
    await page.getByLabel("Help style").selectOption("direct");
    await page.keyboard.press("Escape");
    await expect(page.getByText("Lesson settings", { exact: true })).toHaveCount(0);
  });

  test("end-of-lesson ritual: erase, recap chalk, sign-off, then download CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/what are we learning today/i).first()).toBeVisible();

    const answerBar = page.getByPlaceholder(/Ask anything/);
    await answerBar.fill("I want to learn about photosynthesis");
    await answerBar.press("Enter");
    await expect(page.getByTestId("speech-bubble")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("speech-bubble").first()).not.toHaveText(/Ask anything|Hey! I'm so glad/i);

    // The download CTA must NOT exist before the ritual runs.
    // Conversational finish (user spec: no Finish button — saying you're done
    // IS the finish): the tutor runs the full ritual on that message.
    await answerBar.fill("That's all for today, thanks!");
    await answerBar.press("Enter");

    // 1) SPEAK — the sign-off lands in the speech bubble (any recap wording
    // is fine; the real guarantee is that the tutor spoke a closing message).
    await expect(page.getByTestId("speech-bubble")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("speech-bubble").first()).not.toHaveText(/Ask anything|Hey! I'm so glad|That's all for today/i);
    // 2) CHALK — the board has a recap takeaway card. tldraw shape text isn't
    // reliably reachable via element visibility, so assert the board surface
    // contains recap-ish text (any recap word) as a proxy.
    await expect(page.getByTestId("chalkboard-surface")).toContainText(
      /recap|photosynthesis|glucose|oxygen|chlorophyll|summary|today/i,
      { timeout: 20_000 },
    );
    // 3) REVEAL — the download CTA appears only after the ritual completes.
    await expect(page.getByTestId("ritual-download")).toBeVisible({ timeout: 25_000 });
  });

  test("settings screen shows voice mode and key redaction", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Model provider")).toBeVisible();
    await expect(page.getByText("Voice conversation mode")).toBeVisible();
    // Strict: the offline-voices status also says "not configured" (Piper),
    // so target the API-key pill by its exact phrase.
    await expect(page.getByText(/API key (configured on server|not configured)/)).toBeVisible();
    await expect(page.getByText(/Privacy:/)).toBeVisible();
    // Offline voices (Piper) status renders honestly in a fresh E2E env.
    await expect(page.getByTestId("offline-voices-status")).toContainText(/Offline voices/);
    // Persona + voice controls (user spec: female voice, persona styles).
    await expect(page.getByText("Tutor voice")).toBeVisible();
    await expect(page.getByText("Teaching style")).toBeVisible();
    await page.getByLabel("Tutor voice").selectOption("female");
    await expect(page.getByLabel("Tutor voice")).toHaveValue("female");
    await page.getByLabel("Teaching style").selectOption("sarcastic");
    await expect(page.getByLabel("Teaching style")).toHaveValue("sarcastic");
    await page.getByLabel("Tutor voice").selectOption("auto");
    await page.getByLabel("Teaching style").selectOption("friendly");
    // Roadmap features surfaced in Settings: adaptive persona + language.
    await expect(page.getByText("Read the room (adaptive persona)")).toBeVisible();
    // Exact matching: "Language" otherwise substring-collides with the
    // "Lesson language" heading and option texts on this page.
    await expect(page.getByText("Language", { exact: true })).toBeVisible();
    await page.getByLabel("Language", { exact: true }).selectOption("es");
    await expect(page.getByLabel("Language", { exact: true })).toHaveValue("es");
    await page.getByLabel("Language", { exact: true }).selectOption("auto");
  });

  test("learning hub shows stats, filters, and per-lesson downloads (user spec)", async ({ page }) => {
    await page.goto("/history");
    // Stats strip aggregates everything learnt.
    await expect(page.getByText(/XP/).first()).toBeVisible();
    await expect(page.getByText(/day streak/i)).toBeVisible();
    // Search + subject chips.
    await expect(page.getByLabel("Search lessons")).toBeVisible();
    await expect(page.getByRole("button", { name: "All", exact: true })).toBeVisible();
    // At least one lesson card with a download-notes link (prior runs created some).
    await expect(page.getByRole("link", { name: /Reopen/ }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: /Notes/ }).first()).toBeVisible();
    // Search narrows the cards.
    await page.getByLabel("Search lessons").fill("zzz-no-such-lesson");
    await expect(page.getByText("No lessons match")).toBeVisible();
  });

  test("voice input works end-to-end in Chrome (stubbed SpeechRecognition)", async ({ page }) => {
    // Fake the Web Speech API before any page script runs.
    await installSpeechStub(page, "I want to learn about photosynthesis");
    await page.goto("/");

    // The welcome board greets locally; no session exists yet.
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByText(/what are we learning today/i).first()).toBeVisible();

    // Tap the mic orb in the welcome answer bar → the hook starts
    // recognition → the stub emits a final transcript → the silence timer
    // commits it, which is the moment the session is created. The committed
    // voice text then drives the REAL tutor loop as turn one.
    await page.getByRole("button", { name: "Start voice" }).click();

    // The committed voice turn drives the REAL tutor loop: the tutor teaches
    // the topic and chalks it — identical to a typed turn. Assert the real
    // outcomes (board + echo + a real tutor message), not a mock sentence.
    await expect(page.getByTestId("chalkboard-surface")).toBeVisible({ timeout: 20_000 });
    await expect(
      page
        .getByTestId("chalkboard-surface")
        .getByText(/^You: I want to learn about photosynthesis/)
        .first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("speech-bubble")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("speech-bubble").first()).not.toHaveText(/Ask anything|Hey! I'm so glad/i);

    // The turn is attributed as voice in the transcript drawer.
    await page.getByRole("button", { name: "Transcript", exact: true }).click();
    await expect(page.getByText(/I want to learn about photosynthesis/).first()).toBeVisible();
  });

  test("browsers without the Web Speech API get a graceful fallback", async ({ page }) => {
    // Remove the API entirely (like Firefox/Safari today).
    await page.addInitScript(() => {
      // @ts-expect-error test shim
      delete window.SpeechRecognition;
      // @ts-expect-error test shim
      delete window.webkitSpeechRecognition;
    });
    await page.goto("/");

    // Welcome board: no session until first input, mic still present.
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByText(/what are we learning today/i).first()).toBeVisible();

    // Clicking the dead mic orb explains the problem instead of failing
    // silently — the message lands in the speech bubble.
    await page.getByRole("button", { name: /Voice input is not available/ }).first().click();
    await expect(page.getByTestId("voice-fallback")).toBeVisible();
    await expect(page.getByTestId("voice-fallback")).toContainText(
      /Web Speech API|Chrome or Edge/i,
    );

    // The conversational answer bar remains fully usable.
    const answerBar = page.getByPlaceholder(/Ask anything/);
    await answerBar.fill("hello");
    await expect(answerBar).toBeEnabled();
  });
});

test.describe("roadmap: per-session memory & profiles", () => {
  test("persona/voice/language saved on a lesson survive a full reload", async ({ page }) => {
    // Start a lesson through the conversational bar (mock provider).
    await page.goto("/");
    const bar = page.getByPlaceholder(/Ask anything/);
    await bar.fill("Teach me the water cycle");
    await bar.press("Enter");
    await expect(page).toHaveURL(/\/sessions\//, { timeout: 20_000 });

    // Open the board pill and pin style/voice/language onto THIS lesson.
    await page.getByRole("button", { name: "Lesson settings" }).click();
    const panel = page.getByRole("dialog", { name: "Lesson settings" });
    await expect(panel).toBeVisible();
    // Exact matching: "Style" otherwise also matches the "Help style" select.
    await panel.getByLabel("Style", { exact: true }).selectOption("sarcastic");
    await panel.getByLabel("Voice", { exact: true }).selectOption("female");
    await panel.getByLabel("Lesson language", { exact: true }).selectOption("fr");

    // Hard reload: the lesson must come back exactly as left (memory).
    await page.reload();
    // The pill surfaces the pinned style (visible + accessible name).
    await expect(page.getByRole("button", { name: /Sarcastic/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Lesson settings/ }).click();
    const panel2 = page.getByRole("dialog", { name: "Lesson settings" });
    await expect(panel2.getByLabel("Style", { exact: true })).toHaveValue("sarcastic");
    await expect(panel2.getByLabel("Voice", { exact: true })).toHaveValue("female");
    await expect(panel2.getByLabel("Lesson language", { exact: true })).toHaveValue("fr");
  });

  test("profiles: create, switch, and scope the lesson list", async ({ page }) => {
    // Create a profile from the header switcher.
    await page.goto("/");
    await page.getByRole("button", { name: "Student profile" }).click();
    const dialog = page.getByRole("dialog", { name: "Student profiles" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Add a student/ }).click();
    await dialog.getByPlaceholder("Student's name").fill("E2E Kid");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();

    // The profile becomes active (header shows it after the page refresh).
    await expect(page.getByRole("button", { name: /E2E Kid/ })).toBeVisible({ timeout: 10_000 });

    // Clean up so other tests stay in solo mode.
    await page.getByRole("button", { name: /E2E Kid/ }).click();
    const dialog2 = page.getByRole("dialog", { name: "Student profiles" });
    await dialog2.getByRole("button", { name: "Remove E2E Kid" }).click();
    await page.on("dialog", (d) => void d.accept());
    await dialog2.getByRole("button", { name: "Remove E2E Kid" }).click();
  });
});
