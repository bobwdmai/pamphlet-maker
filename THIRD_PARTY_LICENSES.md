# Third-party licenses

This project vendors one third-party library, unmodified.

## pdf-lib

- **File:** `vendor/pdf-lib.min.js`
- **Version:** 1.17.1
- **Project:** https://github.com/Hopding/pdf-lib
- **License:** MIT
- **Copyright:** (c) 2019 Andrew Dillon

```
MIT License

Copyright (c) 2019 Andrew Dillon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### tslib (bundled inside pdf-lib.min.js)

pdf-lib's build bundles Microsoft's `tslib` TypeScript runtime helpers
internally. Its license notice (Apache License 2.0 / 0BSD depending on
version) is preserved as-is in the header of `vendor/pdf-lib.min.js` and is
not reproduced separately here.

## Book Maker's own EXE packaging (Electron)

The optional Windows packaging (see `electron/`, if present) uses
[Electron](https://www.electronjs.org/) (MIT) and
[electron-builder](https://www.electron.build/) (MIT) as development-time
tooling only — neither ships inside the browser app itself. See each
project's own repository for their full license text.
