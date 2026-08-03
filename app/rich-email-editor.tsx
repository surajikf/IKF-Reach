"use client";

import { useEffect, useRef, useState } from "react";

type RichEmailEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const personalizationFields = [
  { key: "name", label: "Contact Name", syntax: "{{name}}" },
  { key: "company", label: "Company Name", syntax: "{{company}}" },
  { key: "industry", label: "Industry", syntax: "{{industry}}" },
  { key: "website", label: "Website", syntax: "{{website}}" },
  { key: "research", label: "AI Research", syntax: "{{research}}" },
  { key: "topic", label: "Email Topic", syntax: "{{topic}}" },
  { key: "focus_areas", label: "Focus Areas", syntax: "{{focus_areas}}" },
];

const fontSizes = ["10", "11", "12", "14", "16"];

function toolbarCommand(command: string, value?: string) {
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand(command, false, value);
}

// Clicking any toolbar button normally shifts the browser's focus (and, in
// most browsers, clears the live text selection) to that button before its
// onClick even fires — so by the time a formatting command runs, the text
// the user highlighted is already gone. preventDefault on mousedown stops
// the button from taking focus in the first place, so the editor's
// selection is never disturbed. Only safe for plain buttons; native
// <select>/<input type="color"> controls need their dropdown/picker to
// open, so they use a different fix (see captureEditorSelection below).
function preserveSelectionOnMouseDown(event: React.MouseEvent) {
  event.preventDefault();
}

export default function RichEmailEditor({ value, onChange, disabled = false }: RichEmailEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const lastEmitted = useRef<string | null>(null);
  const [fontFamily, setFontFamily] = useState("Calibri");
  const [fontSize, setFontSize] = useState("11");
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [linkUrlInput, setLinkUrlInput] = useState("");
  const [isPreview, setIsPreview] = useState(false);

  useEffect(() => {
    if (!editorRef.current || value === lastEmitted.current) return;
    editorRef.current.innerHTML = value;
    lastEmitted.current = value;
  }, [value]);

  // Captures whatever is currently selected inside the editor into
  // savedSelectionRef, as long as the selection is actually within the
  // editor. Shared by the passive selectionchange listener below and by the
  // toolbar controls' onMouseDown handlers, which call it proactively —
  // right before a click/focus event would otherwise steal the browser's
  // selection away (e.g. opening a native <select> dropdown or a native
  // color picker), so there's no gap where the "last known good" selection
  // could be missed.
  function captureEditorSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedSelectionRef.current = range.cloneRange();
    }
  }

  useEffect(() => {
    document.addEventListener("selectionchange", captureEditorSelection);
    return () => document.removeEventListener("selectionchange", captureEditorSelection);
  }, []);

  function restoreEditorSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const saved = savedSelectionRef.current;
    if (!selection || !saved) return;
    // The editor's innerHTML can be replaced wholesale (e.g. the value prop
    // changing under us) between when a selection was saved and when a
    // toolbar command tries to restore it, leaving the saved Range pointing
    // at detached nodes. Restoring a detached range is a silent no-op in
    // some browsers and a thrown exception in others — either way the
    // command would end up applying at whatever the cursor happens to be,
    // not the text the user actually selected. Skip the restore instead.
    if (!editor.contains(saved.startContainer) || !editor.contains(saved.endContainer)) return;
    selection.removeAllRanges();
    selection.addRange(saved);
  }

  function emitChange() {
    if (!editorRef.current) return;
    const next = editorRef.current.innerHTML;
    lastEmitted.current = next;
    onChange(next);
  }

  function run(command: string, commandValue?: string) {
    if (disabled) return;
    restoreEditorSelection();
    toolbarCommand(command, commandValue);
    emitChange();
  }

  function applyFontSize(size: string) {
    if (disabled || !editorRef.current) return;
    restoreEditorSelection();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("fontSize", false, "7");
    editorRef.current.querySelectorAll('font[size="7"]').forEach((node) => {
      node.removeAttribute("size");
      (node as HTMLElement).style.fontSize = `${size}pt`;
    });
    emitChange();
  }

  function insertPersonalization(key: string) {
    if (!key || disabled) return;
    restoreEditorSelection();
    const label = personalizationFields.find((field) => field.key === key)?.label || key;
    toolbarCommand(
      "insertHTML",
      `<span class="personalization-chip" data-personalization="${key}" contenteditable="false" draggable="true" title="${label}">{{${key}}}</span>&nbsp;`,
    );
    emitChange();
  }

  // contenteditable="false" chips are "atomic" islands that most browsers only
  // remove after two Backspace/Delete presses (one to select, one to delete),
  // and the trailing nbsp inserted alongside each chip eats the first press
  // invisibly — both read as "the chip won't delete." Handle the keys
  // ourselves so one press removes the whole chip (plus that nbsp) cleanly.
  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const editor = editorRef.current;
    if (!editor || !editor.contains(range.startContainer)) return;

    const forward = event.key === "Delete";
    const container = range.startContainer;
    const offset = range.startOffset;

    let candidate: ChildNode | null;
    if (container.nodeType === Node.TEXT_NODE) {
      const length = container.textContent?.length ?? 0;
      if (forward ? offset !== length : offset !== 0) return; // caret is mid-text, not adjacent to a sibling
      candidate = forward ? container.nextSibling : container.previousSibling;
    } else {
      const index = forward ? offset : offset - 1;
      candidate = container.childNodes[index] ?? null;
    }

    // A lone whitespace/nbsp text node sits between the caret and the chip
    // right after insertion — skip over it to see if a chip is just beyond.
    let whitespaceToRemove: ChildNode | null = null;
    if (candidate?.nodeType === Node.TEXT_NODE && /^[\s ]+$/.test(candidate.textContent || "")) {
      whitespaceToRemove = candidate;
      candidate = forward ? candidate.nextSibling : candidate.previousSibling;
    }

    if (candidate?.nodeType === Node.ELEMENT_NODE && (candidate as HTMLElement).classList.contains("personalization-chip")) {
      event.preventDefault();
      whitespaceToRemove?.parentNode?.removeChild(whitespaceToRemove);
      candidate.parentNode?.removeChild(candidate);
      emitChange();
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    restoreEditorSelection();
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("insertHTML", false, escaped.split(/\r\n|\r|\n/).join("<br>"));
    emitChange();
  }

  function addLink() {
    if (disabled) return;
    setLinkUrlInput("");
    setLinkPromptOpen(true);
  }

  function confirmLink() {
    const url = linkUrlInput.trim();
    setLinkPromptOpen(false);
    if (!url) return;
    const normalized = /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}`;
    run("createLink", normalized);
  }

  // Calculate text metrics compact
  const plainText = editorRef.current ? editorRef.current.innerText || "" : "";
  const wordCount = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;
  const tagMatches = (value.match(/\{\{([a-zA-Z0-9_-]+)\}\}/g) || []).length;

  return (
    <div className={`rich-email-composer ${disabled ? "is-disabled" : ""}`}>
      {/* Sleek Minimal Single-Row Toolbar */}
      <div className="rich-email-toolbar compact-single-row" role="toolbar" aria-label="Email formatting">
        <div className="toolbar-group toolbar-history">
          <button type="button" onMouseDown={preserveSelectionOnMouseDown} onClick={() => run("undo")} aria-label="Undo" title="Undo">↶</button>
          <button type="button" onMouseDown={preserveSelectionOnMouseDown} onClick={() => run("redo")} aria-label="Redo" title="Redo">↷</button>
        </div>

        <div className="toolbar-group">
          <label>
            <span className="sr-only">Font family</span>
            <select
              value={fontFamily}
              disabled={disabled}
              className="compact-select"
              onMouseDown={captureEditorSelection}
              onChange={(event) => {
                const next = event.target.value;
                setFontFamily(next);
                run("fontName", next);
              }}
            >
              <option>Calibri</option>
              <option>Arial</option>
              <option>Verdana</option>
              <option>Georgia</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Font size</span>
            <select
              value={fontSize}
              disabled={disabled}
              className="compact-select"
              onMouseDown={captureEditorSelection}
              onChange={(event) => {
                const next = event.target.value;
                setFontSize(next);
                applyFontSize(next);
              }}
            >
              {fontSizes.map((size) => <option key={size} value={size}>{size}pt</option>)}
            </select>
          </label>
        </div>

        <div className="toolbar-group">
          <button type="button" onMouseDown={preserveSelectionOnMouseDown} onClick={() => run("bold")} aria-label="Bold" title="Bold"><strong>B</strong></button>
          <button type="button" onMouseDown={preserveSelectionOnMouseDown} onClick={() => run("italic")} aria-label="Italic" title="Italic"><em>I</em></button>
          <button type="button" onMouseDown={preserveSelectionOnMouseDown} onClick={() => run("underline")} aria-label="Underline" title="Underline"><u>U</u></button>
          <label className="color-control" title="Text colour">
            <span>A</span>
            <input type="color" defaultValue="#20252d" disabled={disabled} onMouseDown={captureEditorSelection} onChange={(event) => run("foreColor", event.target.value)} />
          </label>
        </div>

        <div className="toolbar-group">
          <button type="button" onMouseDown={preserveSelectionOnMouseDown} onClick={() => run("insertUnorderedList")} aria-label="Bulleted list" title="Bulleted list">•</button>
          <button type="button" onMouseDown={preserveSelectionOnMouseDown} onClick={() => run("insertOrderedList")} aria-label="Numbered list" title="Numbered list">1.</button>
          <button type="button" onMouseDown={preserveSelectionOnMouseDown} onClick={addLink} aria-label="Add link" title="Add link">🔗</button>
          <button type="button" onMouseDown={preserveSelectionOnMouseDown} onClick={() => run("removeFormat")} aria-label="Clear formatting" title="Clear formatting">Tx</button>
        </div>

        <div className="toolbar-group toolbar-right-cluster" style={{ marginLeft: "auto" }}>
          <label className="personalization-control">
            <span className="sr-only">Insert personalization</span>
            <select
              defaultValue=""
              disabled={disabled}
              className="btn-personalize-select"
              onMouseDown={captureEditorSelection}
              onChange={(event) => {
                insertPersonalization(event.target.value);
                event.currentTarget.value = "";
              }}
            >
              <option value="" disabled>+ Personalize</option>
              {personalizationFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
            </select>
          </label>

          <button
            type="button"
            className={`compact-preview-toggle ${isPreview ? "is-preview" : ""}`}
            onClick={() => setIsPreview((p) => !p)}
            title={isPreview ? "Switch to edit mode" : "Switch to live preview"}
          >
            {isPreview ? "✏ Edit" : "👁 Preview"}
          </button>
        </div>
      </div>

      {!isPreview ? (
        <div
          ref={editorRef}
          className="rich-email-editor compact-editor-body"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Email template body"
          data-placeholder="Write the campaign email and insert personalization tags where needed."
          onInput={emitChange}
          onBlur={emitChange}
          onPaste={handlePaste}
          onKeyDown={handleEditorKeyDown}
        />
      ) : (
        <div className="editor-compact-preview">
          <div className="preview-mini-header">
            <span>To: Acme Corp &lt;contact@acme.com&gt;</span>
            <span>Subject: DPDP &amp; VAPT Compliance Notice</span>
          </div>
          <div
            className="preview-mini-body"
            dangerouslySetInnerHTML={{
              __html: value
                .replace(/\{\{company\}\}/g, "Acme Corp")
                .replace(/\{\{name\}\}/g, "Priya Sharma")
                .replace(/\{\{topic\}\}/g, "DPDP Readiness 2026")
                .replace(/\{\{industry\}\}/g, "Manufacturing")
                .replace(/\{\{website\}\}/g, "acme.com")
                .replace(/\{\{research\}\}/g, "Acme Corp recently expanded its manufacturing footprint in Pune.")
                .replace(/\{\{focus_areas\}\}/g, "data protection and vendor risk")
            }}
          />
        </div>
      )}

      {/* Ultra-compact Footer Bar */}
      <div className="rich-composer-footer compact-footer">
        <div className="metrics-compact">
          <span>{wordCount} words</span>
          <span>•</span>
          <span>{tagMatches} tags active</span>
        </div>
        <span>Calibri 11pt default</span>
      </div>

      {linkPromptOpen && (
        <div className="confirm-modal-backdrop" role="presentation" onClick={() => setLinkPromptOpen(false)}>
          <div className="confirm-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <p>Paste the full website or email link</p>
            <input
              type="text"
              autoFocus
              value={linkUrlInput}
              onChange={(event) => setLinkUrlInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") confirmLink(); if (event.key === "Escape") setLinkPromptOpen(false); }}
              placeholder="www.example.com or name@example.com"
              style={{ marginTop: 12, width: "100%" }}
            />
            <div className="confirm-modal-actions">
              <button type="button" className="quiet-action" onClick={() => setLinkPromptOpen(false)}>Cancel</button>
              <button type="button" className="primary-action" onClick={confirmLink}>Insert link</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
