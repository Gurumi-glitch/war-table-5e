import { Component, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown rendering that can NEVER black-screen the app. react-markdown's
 * dependency chain calls modern built-ins at render time; on an old embedded
 * browser (the TTS tablet) a missing API throws mid-render and React 18
 * unmounts the whole root. The polyfills in src/lib/polyfills.ts cover the
 * known gaps; this boundary is the belt-and-braces layer — if rendering still
 * throws for ANY reason, the block degrades to the raw text instead of
 * killing the app.
 */
export class MarkdownErrorBoundary extends Component<
  { raw: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <pre
          style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}
          data-testid="markdown-fallback"
        >
          {this.props.raw}
        </pre>
      );
    }
    return this.props.children;
  }
}

/** GFM Markdown (tables/strikethrough/task lists) behind the crash boundary. */
export function SafeMarkdown({ children: raw }: { children: string }) {
  return (
    <MarkdownErrorBoundary raw={raw}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{raw}</ReactMarkdown>
    </MarkdownErrorBoundary>
  );
}
