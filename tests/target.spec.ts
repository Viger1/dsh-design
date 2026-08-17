import { mkdtemp, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hostAllowed, resolveTarget } from '../src/index.js'

let workspace: string
let previousCwd: string

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-design-'))
  await writeFile(join(workspace, 'page.html'), '<html></html>')
  await writeFile(join(workspace, 'notes.txt'), 'not a page')
  await mkdir(join(workspace, 'site'))
  await writeFile(join(workspace, 'site', 'index.html'), '<html></html>')
  previousCwd = process.cwd()
  process.chdir(workspace)
})

afterAll(() => {
  process.chdir(previousCwd)
})

describe('hostAllowed', () => {
  it('always admits local hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(hostAllowed(host, [])).toBe(true)
    }
  })

  it('admits configured hosts exactly, not by suffix', () => {
    expect(hostAllowed('example.com', ['example.com'])).toBe(true)
    expect(hostAllowed('evil-example.com', ['example.com'])).toBe(false)
    expect(hostAllowed('sub.example.com', ['example.com'])).toBe(false)
  })
})

describe('resolveTarget', () => {
  it('accepts a local URL and refuses an unlisted host', async () => {
    await expect(resolveTarget('http://localhost:3000/x', [])).resolves.toBe('http://localhost:3000/x')
    await expect(resolveTarget('https://example.com', [])).rejects.toThrow(/is not allowed/)
    await expect(resolveTarget('https://example.com', ['example.com'])).resolves.toContain('example.com')
  })

  it('resolves an HTML file inside the workspace', async () => {
    await expect(resolveTarget('page.html', [])).resolves.toMatch(/page\.html$/)
  })

  it('resolves a directory to its index.html', async () => {
    await expect(resolveTarget('site', [])).resolves.toMatch(/site\/index\.html$/)
  })

  it('refuses a path outside the workspace, including through a symlink', async () => {
    await expect(resolveTarget('../..', [])).rejects.toThrow(/outside the workspace|not an HTML file/)
    const outside = await mkdtemp(join(tmpdir(), 'dsh-design-out-'))
    await writeFile(join(outside, 'secret.html'), '<html></html>')
    await symlink(outside, resolve(workspace, 'link'))
    await expect(resolveTarget('link/secret.html', [])).rejects.toThrow(/outside the workspace/)
  })

  it('refuses a non-HTML file rather than rendering it', async () => {
    await expect(resolveTarget('notes.txt', [])).rejects.toThrow(/not an HTML file/)
  })

  it('reports a missing file as missing', async () => {
    await expect(resolveTarget('nope.html', [])).rejects.toThrow(/neither a URL nor an existing file/)
  })
})
