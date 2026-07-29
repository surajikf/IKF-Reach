"use client";

import { useEffect, useRef, useState } from "react";

type RichEmailEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const personalizationFields = [
  { key: "name", label: "Contact name" },
  { key: "company", label: "Company name" },
  { key: "industry", label: "Industry" },
  { key: "website", label: "Website" },
  { key: "research", label: "Research summary" },
  { key: "topic", label: "Email topic" },
  { key: "focus_areas", label: "Focus areas" },
];

const fontSizes = ["10", "11", "12", "14", "16", "18"];

function toolbarCommand(command: string, value?: string) {
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand(command, false, value);
}

export default function RichEmailEditor({ value, onChange, disabled = false }: RichEmailEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const lastEmitted = useRef(value);
  const [fontFamily, setFontFamily] = useState("Calibri");
  const [fontSize, setFontSize] = useState("11");

  useEffect(() => {
    if (!editorRef.current || value === lastEmitted.current) return;
    editorRef.current.innerHTML = value;
    lastEmitted.current = value;
  }, [value]);

  useEffect(() => {
    function rememberEditorSelection() {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      }
    }
    document.addEventListener("selectionchange", rememberEditorSelection);
    return () => document.removeEventListener("selectionchange", rememberEditorSelection);
  }, []);

  function restoreEditorSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection || !savedSelectionRef.current) return;
    selection.removeAllRanges();
    selection.addRange(savedSelectionRef.current);
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
      `<span class="personalization-chip" data-personalization="${key}" contenteditable="false" title="${label}">{{${key}}}</span>&nbsp;`,
    );
    emitChange();
  }

  function addLink() {
    if (disabled) return;
    const url = window.prompt("Paste the full website or email link");
    if (!url) return;
    const normalized = /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}`;
    run("createLink", normalized);
  }

  return (
    <div className={`rich-email-composer ${disabled ? "is-disabled" : ""}`}>
      <div className="rich-email-toolbar" role="toolbar" aria-label="Email formatting">
        <div className="toolbar-group toolbar-history">
          <button type="button" onClick={() => run("undo")} aria-label="Undo" title="Undo">↶</button>
          <button type="button" onClick={() => run("redo")} aria-label="Redo" title="Redo">↷</button>
        </div>
        <div className="toolbar-group">
          <label>
            <span className="sr-only">Font family</span>
            <select
              value={fontFamily}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value;
                setFontFamily(next);
                run("fontName", next);
              }}
              aria-label="Font family"
            >
              <option>Calibri</option>
              <option>Arial</option>
              <option>Verdana</option>
              <option>Tahoma</option>
              <option>Georgia</option>
              <option>Times New Roman</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Font size</span>
            <select
              value={fontSize}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value;
                setFontSize(next);
                applyFontSize(next);
              }}
              aria-label="Font size"
            >
              {fontSizes.map((size) => <option key={size} value={size}>{size} pt</option>)}
            </select>
          </label>
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={() => run("bold")} aria-label="Bold" title="Bold"><strong>B</strong></button>
          <button type="button" onClick={() => run("italic")} aria-label="Italic" title="Italic"><em>I</em></button>
          <button type="button" onClick={() => run("underline")} aria-label="Underline" title="Underline"><u>U</u></button>
          <label className="color-control" title="Text colour">
            <span>A</span>
            <input type="color" defaultValue="#20252d" disabled={disabled} onChange={(event) => run("foreColor", event.target.value)} aria-label="Text colour" />
          </label>
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={() => run("insertUnorderedList")} aria-label="Bulleted list" title="Bulleted list">• List</button>
          <button type="button" onClick={() => run("insertOrderedList")} aria-label="Numbered list" title="Numbered list">1. List</button>
          <button type="button" onClick={() => run("justifyLeft")} aria-label="Align left" title="Align left">≡</button>
          <button type="button" onClick={() => run("justifyCenter")} aria-label="Align centre" title="Align centre">≣</button>
          <button type="button" onClick={addLink} aria-label="Add link" title="Add link">🔗</button>
          <button type="button" onClick={() => run("removeFormat")} aria-label="Clear formatting" title="Clear formatting">Tx</button>
        </div>
        <div className="toolbar-group personalization-control">
          <label>
            <span className="sr-only">Insert personalization</span>
            <select
              defaultValue=""
              disabled={disabled}
              onChange={(event) => {
                insertPersonalization(event.target.value);
                event.currentTarget.value = "";
              }}
              aria-label="Insert personalization"
            >
              <option value="" disabled>+ Personalize</option>
              {personalizationFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div
        ref={editorRef}
        className="rich-email-editor"
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Email template body"
        data-placeholder="Write the campaign email and insert personalization where needed."
        onInput={emitChange}
        onBlur={emitChange}
        onPaste={() => window.setTimeout(emitChange, 0)}
        dangerouslySetInnerHTML={{ __html: value }}
      />
      <div className="rich-composer-footer">
        <span><strong>Calibri 11 pt</strong> is the campaign default.</span>
        <span>Formatting and personalization are saved with this campaign template.</span>
      </div>
    </div>
  );
}
