import { cp, mkdir, rm } from 'node:fs/promises'
const target = new URL('../public/video-codec/', import.meta.url)
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(new URL('../node_modules/@ffmpeg/core/dist/esm/', import.meta.url), target, { recursive: true })
await cp(new URL('../node_modules/@ffmpeg/ffmpeg/dist/esm/', import.meta.url), new URL('wrapper/', target), { recursive: true, filter: (source) => !source.endsWith('.d.ts') && !source.endsWith('.map') })
