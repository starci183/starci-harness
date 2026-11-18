/*
 * The maths of a slippy map: Web Mercator (the projection every tile set of this kind is cut in), a view as a centre and a
 * fractional zoom, and a grid cluster. Pure functions, so the component keeps only the gesture and the draw.
 */

export const TILE_SIZE = 256
const MAX_LATITUDE = 85.0511287798

export type LatLng = { readonly lat: number; readonly lng: number }
export type GeoView = LatLng & { readonly zoom: number }
export type Size = { readonly width: number; readonly height: number }
export type Pixel = { readonly x: number; readonly y: number }

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** The size in pixels of the whole world at a zoom. */
export const worldSize = (zoom: number): number => TILE_SIZE * 2 ** zoom

/** A place as a pixel of the world at a zoom (the origin is the north-west corner of the world). */
export const project = ({ lat, lng }: LatLng, zoom: number): Pixel => {
    const size = worldSize(zoom)
    const sin = Math.sin((clamp(lat, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180)
    return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size }
}

/** A pixel of the world at a zoom as a place: the inverse of `project`. */
export const unproject = ({ x, y }: Pixel, zoom: number): LatLng => {
    const size = worldSize(zoom)
    const lng = (x / size) * 360 - 180
    const n = Math.PI - (2 * Math.PI * y) / size
    return { lat: clamp((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), -MAX_LATITUDE, MAX_LATITUDE), lng: clamp(lng, -180, 180) }
}

/** Where a place falls inside a viewport of `size` showing `view`. */
export const toScreen = (place: LatLng, view: GeoView, size: Size): Pixel => {
    const centre = project(view, view.zoom)
    const at = project(place, view.zoom)
    return { x: at.x - centre.x + size.width / 2, y: at.y - centre.y + size.height / 2 }
}

/** The place under a pixel of the viewport. */
export const fromScreen = (pixel: Pixel, view: GeoView, size: Size): LatLng => {
    const centre = project(view, view.zoom)
    return unproject({ x: centre.x + pixel.x - size.width / 2, y: centre.y + pixel.y - size.height / 2 }, view.zoom)
}

/** The view moved by a number of screen pixels. */
export const panBy = (view: GeoView, dx: number, dy: number): GeoView => {
    const centre = project(view, view.zoom)
    return { ...unproject({ x: centre.x - dx, y: centre.y - dy }, view.zoom), zoom: view.zoom }
}

/** The view at a new zoom that keeps the place under `anchor` where it is: a zoom about the pointer or the pinch. */
export const zoomAbout = (view: GeoView, zoom: number, anchor: Pixel, size: Size): GeoView => {
    const place = fromScreen(anchor, view, size)
    const anchored = project(place, zoom)
    return { ...unproject({ x: anchored.x - anchor.x + size.width / 2, y: anchored.y - anchor.y + size.height / 2 }, zoom), zoom }
}

export type Bounds = { readonly south: number; readonly west: number; readonly north: number; readonly east: number }

export const boundsOf = (places: readonly LatLng[]): Bounds | null => {
    const first = places[0]
    if (first === undefined) return null
    let south = first.lat
    let north = first.lat
    let west = first.lng
    let east = first.lng
    for (const place of places) {
        south = Math.min(south, place.lat)
        north = Math.max(north, place.lat)
        west = Math.min(west, place.lng)
        east = Math.max(east, place.lng)
    }
    return { south, west, north, east }
}

/** The view that holds `bounds` in a viewport with `padding` pixels to spare; a single place takes `soloZoom`. */
export const fitBounds = (bounds: Bounds, size: Size, limits: { readonly min: number; readonly max: number }, padding: number, soloZoom: number): GeoView => {
    const centre = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 }
    const topLeft = project({ lat: bounds.north, lng: bounds.west }, 0)
    const bottomRight = project({ lat: bounds.south, lng: bounds.east }, 0)
    const dx = bottomRight.x - topLeft.x
    const dy = bottomRight.y - topLeft.y
    if (dx < 1e-9 && dy < 1e-9) return { ...centre, zoom: clamp(soloZoom, limits.min, limits.max) }
    const fitX = dx < 1e-9 ? Infinity : Math.log2(Math.max(1, size.width - 2 * padding) / dx)
    const fitY = dy < 1e-9 ? Infinity : Math.log2(Math.max(1, size.height - 2 * padding) / dy)
    // The centre of the box in the projection, not in degrees, so a tall box is not pushed off by the Mercator stretch.
    const middle = unproject({ x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2 }, 0)
    return { ...middle, zoom: clamp(Math.min(fitX, fitY), limits.min, limits.max) }
}

/** A thing on the map with a count, as far as clustering goes. */
export type Weighted = LatLng & { readonly id: string; readonly count: number }

export type Cluster<T extends Weighted> = {
    /** The members, in the order given; one member is a single point. */
    readonly members: readonly T[]
    readonly total: number
    /** The count-weighted centre of the members. */
    readonly lat: number
    readonly lng: number
    readonly pixel: Pixel
}

/**
 * Groups the points that fall in one square of `cell` screen pixels at this view: the grid cluster, simple and stable while the
 * view pans (a point keeps its square) and recomputed when the zoom changes.
 */
export const clusterPoints = <T extends Weighted>(points: readonly T[], view: GeoView, size: Size, cell: number): readonly Cluster<T>[] => {
    const buckets = new Map<string, T[]>()
    const centre = project(view, view.zoom)
    for (const point of points) {
        const at = project(point, view.zoom)
        const key = `${Math.floor(at.x / cell)}:${Math.floor(at.y / cell)}`
        const bucket = buckets.get(key)
        if (bucket === undefined) buckets.set(key, [point])
        else bucket.push(point)
    }
    return Array.from(buckets.values()).map((members) => {
        const total = members.reduce((sum, member) => sum + Math.max(0, member.count), 0)
        const weight = total === 0 ? members.length : total
        const lat = members.reduce((sum, member) => sum + member.lat * (total === 0 ? 1 : Math.max(0, member.count)), 0) / weight
        const lng = members.reduce((sum, member) => sum + member.lng * (total === 0 ? 1 : Math.max(0, member.count)), 0) / weight
        const at = project({ lat, lng }, view.zoom)
        return { members, total, lat, lng, pixel: { x: at.x - centre.x + size.width / 2, y: at.y - centre.y + size.height / 2 } }
    })
}

export type TileSpec = { readonly key: string; readonly z: number; readonly x: number; readonly y: number; readonly left: number; readonly top: number; readonly size: number }

/** The tiles that cover the viewport: the integer zoom below the view's, each scaled by the fraction. Rows off the world are skipped and columns wrap. */
export const tilesFor = (view: GeoView, size: Size, maxZoom: number, cap = 80): readonly TileSpec[] => {
    const z = clamp(Math.floor(view.zoom), 0, maxZoom)
    const scale = 2 ** (view.zoom - z)
    const centre = project(view, z)
    const span = 2 ** z
    const halfW = size.width / (2 * scale)
    const halfH = size.height / (2 * scale)
    const minX = Math.floor((centre.x - halfW) / TILE_SIZE)
    const maxX = Math.floor((centre.x + halfW) / TILE_SIZE)
    const minY = Math.max(0, Math.floor((centre.y - halfH) / TILE_SIZE))
    const maxY = Math.min(span - 1, Math.floor((centre.y + halfH) / TILE_SIZE))
    const tiles: TileSpec[] = []
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const wrapped = ((x % span) + span) % span
            tiles.push({ key: `${z}/${x}/${y}`, z, x: wrapped, y, left: (x * TILE_SIZE - centre.x) * scale + size.width / 2, top: (y * TILE_SIZE - centre.y) * scale + size.height / 2, size: TILE_SIZE * scale })
            if (tiles.length >= cap) return tiles
        }
    }
    return tiles
}

/** Fills `{z}`, `{x}` and `{y}` of a tile address. */
export const tileAddress = (template: string, tile: Pick<TileSpec, "z" | "x" | "y">): string =>
    template.replaceAll("{z}", String(tile.z)).replaceAll("{x}", String(tile.x)).replaceAll("{y}", String(tile.y))
