import test from 'node:test';
import assert from 'node:assert/strict';
import {captureDropItems,collectDropped,walkEntry} from '../src/scripts/upload-drop.ts';

// The directory reader API returns a batch per call and an empty array once the
// listing is exhausted. Model that so walkEntry terminates like in a browser.
function reader(children, onRead = () => {}) {
  let done = false;
  return { readEntries(ok) { if (done) return ok([]); done = true; onRead(); ok(children); } };
}
function fileEntry(name, blob, revoke) {
  return {
    isFile: true, isDirectory: false, name,
    file(done) { revoke(); done(blob); },
    createReader: () => reader([])
  };
}
// Drag data access is protected by the browser and revoked as soon as the drop
// handler yields. Simulate that: after the first async read every accessor
// returns null, exactly like a real DataTransfer after the first await.
function revocableItems(names) {
  let valid = true;
  const revoke = () => { valid = false; };
  return names.map(name => {
    const blob = new File(['x'], name);
    return {
      webkitGetAsEntry() {
        if (!valid) return null;
        return fileEntry(name, blob, revoke);
      },
      getAsFile() { return valid ? blob : null; }
    };
  });
}

test('every dropped item is captured before the drag data is revoked', () => {
  const items = revocableItems(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4']);
  const captures = captureDropItems(items);
  assert.equal(captures.length, 5);
  assert.ok(captures.every(capture => capture.entry || capture.file), 'All five items must be captured synchronously');
  assert.equal(captures.filter(capture => capture.file).length, 5);
});

test('collectDropped keeps every file even after drag data revocation', async () => {
  const items = revocableItems(['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4']);
  const all = await collectDropped(items);
  assert.deepEqual(all.map(dropped => dropped.file.name), ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4']);
});

test('a dragged folder keeps its relative paths', async () => {
  let valid = true;
  const revoke = () => { valid = false; };
  const folder = {
    webkitGetAsEntry() {
      if (!valid) return null;
      return {
        isFile: false, isDirectory: true, name: 'carpeta',
        createReader: () => reader(
          ['uno.mp4', 'dos.mp4'].map(child => fileEntry(child, new File(['x'], child), revoke)),
          revoke
        )
      };
    },
    getAsFile() { return null; }
  };
  const all = await collectDropped([folder]);
  assert.deepEqual(all.map(dropped => dropped.path), ['carpeta/uno.mp4', 'carpeta/dos.mp4']);
});

test('walkEntry keeps nested folder paths', async () => {
  const entry = {
    isFile: false, isDirectory: true, name: 'raiz',
    createReader: () => reader([
      fileEntry('top.mp4', new File(['x'], 'top.mp4'), () => {}),
      {
        isFile: false, isDirectory: true, name: 'sub',
        createReader: () => reader([fileEntry('deep.mp4', new File(['x'], 'deep.mp4'), () => {})])
      }
    ])
  };
  const all = await walkEntry(entry);
  assert.deepEqual(all.map(dropped => dropped.path), ['raiz/top.mp4', 'raiz/sub/deep.mp4']);
});
