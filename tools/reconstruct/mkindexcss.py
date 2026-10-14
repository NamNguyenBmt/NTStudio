# Rebuild src/renderer/src/index.css byte-exactly: theme block copied from the shipped CSS (it is emitted verbatim),
# Tailwind layers written in the same style (CRLF, single quotes, 2-space indent).
import sys
css = open(sys.argv[1], "rb").read()
out = sys.argv[2]
start = css.index(b"/* Fluent Command Suite")
end = css.index(b"--c-overlay: 15 23 42;", css.index(b"[data-theme='light']"))
end = css.index(b"}", end) + 1
theme = css[start:end].replace(b"\r\n", b"\n")
rest = """

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html,
  body,
  #root {
    @apply h-full;
  }
  body {
    @apply m-0 select-none overflow-hidden bg-surface font-sans text-body-md text-on-surface antialiased;
    overscroll-behavior: none;
  }
  input,
  textarea,
  [contenteditable='true'] {
    @apply select-text;
  }
  :focus-visible {
    @apply outline-none ring-2 ring-primary-container/70 ring-offset-0;
  }
}

@layer utilities {
  .app-drag {
    -webkit-app-region: drag;
  }
  .no-drag {
    -webkit-app-region: no-drag;
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }
  .mica {
    @apply backdrop-blur-xl backdrop-saturate-150;
  }
  /* Hàng cuộn ngang (tab, chip) – vẫn cuộn được bằng chuột/trackpad nhưng không hiện thanh cuộn */
  .no-scrollbar {
    scrollbar-width: none;
  }
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  /* Scrollbar mảnh kiểu Fluent */
  .scroll-thin {
    scrollbar-width: thin;
    scrollbar-color: rgb(var(--c-outline-variant)) transparent;
  }
  .scroll-thin::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .scroll-thin::-webkit-scrollbar-thumb {
    background: rgb(var(--c-outline-variant) / 0.6);
    border-radius: 9999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  .scroll-thin::-webkit-scrollbar-track {
    background: transparent;
  }
}
""".encode("utf8")
import os
HEADS = {
  "none": b"",
  "imports": b'@import "@fontsource-variable/inter";\n@import "@fontsource-variable/jetbrains-mono";\n',
  "imports_blank": b'@import "@fontsource-variable/inter";\n@import "@fontsource-variable/jetbrains-mono";\n\n',
  "imports_sq": b"@import '@fontsource-variable/inter';\n@import '@fontsource-variable/jetbrains-mono';\n",
}
head = HEADS[os.environ.get("HEAD_VARIANT", "imports")]  # bản gốc: font Inter/JetBrains @import ngay đầu index.css
text = (head + theme + rest).replace(b"\n", b"\r\n")
open(out, "wb").write(text)
print(len(text))
