import { beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { LocaleProvider } from "../i18n";
import { Home } from "./Home";

vi.mock("convex/react", () => ({ useMutation: vi.fn(), useQuery: vi.fn() }));
vi.mock("../api", () => ({
  api: {
    games: { create: "games.create", getDeploymentMode: "games.getDeploymentMode" },
  },
}));

const mockedUseMutation = vi.mocked(useMutation) as unknown as {
  mockReturnValue: (value: ReturnType<typeof vi.fn>) => void;
};
const mockedUseQuery = vi.mocked(useQuery) as unknown as {
  mockReturnValue: (value: unknown) => void;
};

let createGame: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // The language-switch test persists a locale for the device; without this,
  // every test after it silently runs in whatever language ran last.
  localStorage.clear();
  createGame = vi.fn().mockResolvedValue({ playerToken: "player", dmToken: "secret" });
  writeText = vi.fn().mockResolvedValue(undefined);
  mockedUseMutation.mockReturnValue(createGame);
  // Self-host default unless a test says otherwise — the same safe side the
  // server takes when PLAYGROUND_MODE is unset.
  mockedUseQuery.mockReturnValue({ playgroundMode: false });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

test("creates a themed game landing flow with copyable Player and DM URLs", async () => {
  render(<Home />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "建立遊戲" }));
  });
  expect(createGame).toHaveBeenCalledWith({});

  const playerUrl = `${window.location.origin}/play/player`;
  const dmUrl = `${window.location.origin}/dm/player/secret`;
  const playerCopy = await screen.findByRole("button", { name: "copy Player URL" });
  const dmCopy = screen.getByRole("button", { name: "copy DM URL" });
  expect(screen.getByRole("link", { name: playerUrl })).toHaveAttribute("href", playerUrl);
  expect(screen.getByRole("link", { name: dmUrl })).toHaveAttribute("href", dmUrl);
  expect(screen.getByText("DM URL 是唯一憑證", { exact: false })).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(playerCopy);
  });
  expect(writeText).toHaveBeenCalledWith(playerUrl);
  expect(playerCopy).toHaveTextContent("已複製");

  await act(async () => {
    fireEvent.click(dmCopy);
  });
  expect(writeText).toHaveBeenLastCalledWith(dmUrl);
  expect(dmCopy).toHaveTextContent("已複製");
});

test("the landing page offers the language switch before a game exists", async () => {
  localStorage.clear();
  render(
    <LocaleProvider>
      <Home />
    </LocaleProvider>,
  );
  // Default zh-TW; clicking the 🌐 button cycles to English immediately.
  expect(screen.getByRole("button", { name: "建立遊戲" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "語言" }));
  expect(screen.getByRole("button", { name: "Create Game" })).toBeInTheDocument();
  // The choice persists for the device (localStorage).
  expect(localStorage.getItem("dnd-locale")).toBe("en");
});

test("the onboarding guide tells a first-time DM what to do after creating a game", () => {
  render(
    <LocaleProvider>
      <Home />
    </LocaleProvider>,
  );
  // Present before a game exists: the question "what now?" arrives on landing,
  // not after the URLs appear.
  expect(screen.getByRole("heading", { name: "接下來做什麼" })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});

test("no playground banner on a deployment with the flag unset", () => {
  render(
    <LocaleProvider>
      <Home />
    </LocaleProvider>,
  );
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
});

test("playground deployments warn about the wipe and name Export as the way out", () => {
  mockedUseQuery.mockReturnValue({ playgroundMode: true });
  render(
    <LocaleProvider>
      <Home />
    </LocaleProvider>,
  );
  const banner = screen.getByRole("note");
  // Both load-bearing elements: data goes away, and here is how to keep it.
  expect(banner).toHaveTextContent("定期清空");
  expect(banner).toHaveTextContent("匯出");
});

test("the banner waits for the server rather than guessing while loading", () => {
  mockedUseQuery.mockReturnValue(undefined);
  render(
    <LocaleProvider>
      <Home />
    </LocaleProvider>,
  );
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
});

test("the landing page offers the source and states the licence", () => {
  // Not our AGPL §13 duty — that binds whoever modifies and serves it. The
  // link exists so a fork complies by editing one constant instead of having
  // to invent the mechanism.
  render(
    <LocaleProvider>
      <Home />
    </LocaleProvider>,
  );
  const link = screen.getByRole("link", { name: "原始碼" });
  expect(link).toHaveAttribute("href", expect.stringContaining("github.com"));
  // Opens away from a live game; noreferrer keeps the DM URL out of Referer.
  expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  expect(screen.getByText(/AGPL-3\.0/)).toBeInTheDocument();
});
