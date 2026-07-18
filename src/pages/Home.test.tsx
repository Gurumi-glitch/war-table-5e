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

function renderHome({ locale = false }: { locale?: boolean } = {}) {
  return render(locale ? <LocaleProvider><Home /></LocaleProvider> : <Home />);
}

beforeEach(() => {
  localStorage.clear();
  createGame = vi.fn().mockResolvedValue({ playerToken: "player", dmToken: "secret" });
  writeText = vi.fn().mockResolvedValue(undefined);
  mockedUseMutation.mockReturnValue(createGame);
  mockedUseQuery.mockReturnValue({ playgroundMode: false });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

test("introduces the toolkit and its manual-first combat workflow", () => {
  renderHome({ locale: true });

  expect(screen.getByRole("heading", { name: "把規則留在手邊，把裁決留在桌上。" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "從空桌到第一個 Confirm" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Dice → Claim → Confirm" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "自動化永遠不能否決桌上的裁決" })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
});

test("creates a game with copyable Player and secret DM URLs", async () => {
  renderHome({ locale: true });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "建立遊戲" }));
  });
  expect(createGame).toHaveBeenCalledWith({});

  const playerUrl = `${window.location.origin}/play/player`;
  const dmUrl = `${window.location.origin}/dm/player/secret`;
  const playerCopy = await screen.findByRole("button", { name: "複製 Player URL" });
  const dmCopy = screen.getByRole("button", { name: "複製 DM URL" });
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

test("offers the language switch before a game exists", () => {
  renderHome({ locale: true });
  expect(screen.getByRole("button", { name: "建立遊戲" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "語言" }));
  expect(screen.getByRole("button", { name: "Create Game" })).toBeInTheDocument();
  expect(localStorage.getItem("dnd-locale")).toBe("en");
});

test("self-hosted deployments contain no demo-only copy", () => {
  renderHome({ locale: true });
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  expect(screen.queryByText(/定期清空/)).not.toBeInTheDocument();
  expect(screen.queryByText(/公開試玩站/)).not.toBeInTheDocument();
});

test("PLAYGROUND_MODE gates the wipe and Export warning", () => {
  mockedUseQuery.mockReturnValue({ playgroundMode: true });
  renderHome({ locale: true });
  const banner = screen.getByRole("note");
  expect(banner).toHaveTextContent("公開試玩站");
  expect(banner).toHaveTextContent("定期清空");
  expect(banner).toHaveTextContent("匯出");
});

test("the demo banner waits for the backend gate while loading", () => {
  mockedUseQuery.mockReturnValue(undefined);
  renderHome({ locale: true });
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  expect(screen.queryByText(/定期清空/)).not.toBeInTheDocument();
});

test("offers source and licence information", () => {
  renderHome({ locale: true });
  const link = screen.getByRole("link", { name: "原始碼" });
  expect(link).toHaveAttribute("href", expect.stringContaining("github.com"));
  expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  expect(screen.getByText(/AGPL-3\.0/)).toBeInTheDocument();
});
