// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import DEMData from '../../src/data/dem_data';
import {RGBAImage} from '../../src/util/image';

export function createConstElevationDEM(elevation, tileSize) {
    const pixelCount = (tileSize + 2) * (tileSize + 2);
    const pixelData = new Uint8Array(pixelCount * 4);
    const encoded = DEMData.pack(elevation, "mapbox");

    for (let i = 0; i < pixelCount * 4; i += 4) {
        pixelData[i + 0] = encoded[0];
        pixelData[i + 1] = encoded[1];
        pixelData[i + 2] = encoded[2];
        pixelData[i + 3] = encoded[3];
    }
    return new DEMData(0, new RGBAImage({height: tileSize + 2, width: tileSize + 2}, pixelData), "mapbox");
}

export function setMockElevationTerrain(map, demData, tileSize, maxzoom) {
    map.addSource('mapbox-dem', {
        "type": "raster-dem",
        "tiles": ['http://example.com/{z}/{x}/{y}.png'],
        tileSize,
        "maxzoom": maxzoom ? maxzoom : 14
    });
    const cache = map.style.getOwnSourceCache('mapbox-dem');
    cache.used = cache._sourceLoaded = true;
    cache._loadTile = (tile, callback) => {
        tile.dem = demData;
        tile.needsHillshadePrepare = true;
        tile.needsDEMTextureUpload = true;
        tile.state = 'loaded';
        callback(null);
    };
    map.setTerrain({"source": "mapbox-dem"});
}
