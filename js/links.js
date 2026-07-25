function setStatus(message, type) {
  const el = document.getElementById("status");
  if (!message) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<div class="status-banner ${type}">${message}</div>`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function parseLinksMarkdown(text) {
  const sections = [];
  let current = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      current = { category: heading[1].trim(), links: [] };
      sections.push(current);
      continue;
    }

    const item = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)\s*(.*)/);
    if (item) {
      if (!current) {
        current = { category: null, links: [] };
        sections.push(current);
      }
      current.links.push({ label: item[1].trim(), url: item[2].trim(), description: item[3].trim() });
    }
  }

  return sections;
}

function renderLinks(sections) {
  const content = document.getElementById("content");
  content.innerHTML = "";

  for (const section of sections) {
    const panel = document.createElement("section");
    panel.className = "panel";

    if (section.category) {
      const h3 = document.createElement("h3");
      h3.textContent = section.category;
      panel.appendChild(h3);
    }

    const list = document.createElement("ul");
    list.className = "link-list";
    for (const link of section.links) {
      const li = document.createElement("li");
      li.innerHTML = `
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>
        ${link.description ? `<div class="link-description">${escapeHtml(link.description)}</div>` : ""}
      `;
      list.appendChild(li);
    }
    panel.appendChild(list);

    content.appendChild(panel);
  }

  content.hidden = false;
}

async function loadLinks() {
  setStatus("Loading links…", "info");

  let text;
  try {
    const res = await fetch("data/links.md");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    setStatus(`Couldn't load the links list (${err.message}). Try reloading.`, "error");
    return;
  }

  const sections = parseLinksMarkdown(text);
  if (sections.length === 0) {
    setStatus("No links found.", "info");
    return;
  }

  setStatus(null);
  renderLinks(sections);
}

loadLinks();
