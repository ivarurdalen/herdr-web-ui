import { describe, expect, it } from "bun:test";

import { defaultLens, PaneLenses } from "./paneLens.ts";

describe("defaultLens", () => {
  it("follows Settings: chat for an agent (or one not known yet), the terminal for a shell", () => {
    expect(defaultLens(true, "chat")).toBe("chat");
    expect(defaultLens(null, "chat")).toBe("chat");
    expect(defaultLens(false, "chat")).toBe("terminal");
    expect(defaultLens(true, "terminal")).toBe("terminal");
    expect(defaultLens(null, "terminal")).toBe("terminal");
  });

  it("opens an agent pane in the chat on Auto on every device, a shell in the terminal", () => {
    expect(defaultLens(true, "auto")).toBe("chat");
    expect(defaultLens(null, "auto")).toBe("chat");
    expect(defaultLens(false, "auto")).toBe("terminal");
  });
});

describe("PaneLenses", () => {
  it("keeps a shell's terminal when an agent starts in it, with the default view on chat", () => {
    const lenses = new PaneLenses("chat");
    expect(lenses.of("local/w1:p2", false)).toBe("terminal");
    // claude started in the split's shell: the pane in use stays on its terminal
    expect(lenses.of("local/w1:p2", true)).toBe("terminal");
  });

  it("keeps an agent pane's chat when its agent exits", () => {
    const lenses = new PaneLenses("chat");
    expect(lenses.of("local/w1:p1", true)).toBe("chat");
    expect(lenses.of("local/w1:p1", false)).toBe("chat");
  });

  it("settles nothing while the snapshot does not know the pane yet", () => {
    const lenses = new PaneLenses("chat");
    expect(lenses.of("local/w1:p3", null)).toBe("chat");
    expect(lenses.of("local/w1:p3", false)).toBe("terminal");
    expect(lenses.of("local/w1:p3", true)).toBe("terminal");
  });

  it("gives a pane this page started an agent in an agent's lens, even if a snapshot first shows its shell", () => {
    const lenses = new PaneLenses("chat");
    lenses.startedAgent("local/w2:p1");
    expect(lenses.of("local/w2:p1", false)).toBe("chat");
  });

  it("keeps each pane apart", () => {
    const lenses = new PaneLenses("chat");
    expect(lenses.of("local/w1:p1", true)).toBe("chat");
    expect(lenses.of("remote/w1:p1", false)).toBe("terminal");
  });
});
