const ID_TO_ROOT_KEY = {
  "1": "bookmark_bar",
  "2": "other",
  "3": "synced",
};

function unixMsToChromeTimestamp(unixMs) {
  if (!unixMs) {
    return undefined;
  }
  return String((unixMs + 11644473600000) * 1000);
}

function convertNode(apiNode) {
  const dateAdded = unixMsToChromeTimestamp(apiNode.dateAdded);

  if (apiNode.url) {
    return {
      id: apiNode.id,
      name: apiNode.title || "",
      type: "url",
      url: apiNode.url,
      date_added: dateAdded,
    };
  }

  return {
    id: apiNode.id,
    name: apiNode.title || "",
    type: "folder",
    date_added: dateAdded,
    date_modified: unixMsToChromeTimestamp(apiNode.dateGroupModified) || dateAdded,
    children: (apiNode.children || []).map(convertNode),
  };
}

export function chromeApiTreeToRawText(apiTree) {
  const rootNode = apiTree[0];
  const roots = {};

  for (const child of rootNode.children) {
    const key = ID_TO_ROOT_KEY[child.id] || child.title.toLowerCase().replace(/\s+/g, "_");
    roots[key] = convertNode(child);
  }

  return JSON.stringify({ roots, version: 1 });
}
