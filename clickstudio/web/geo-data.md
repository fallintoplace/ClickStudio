# Map data

The map background uses Natural Earth's **1:50m Admin 0 countries** dataset. `1:50m` means a scale of 1:50 million; `Admin 0` means country-level boundaries.

## Source

- [Original GeoJSON file](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson)
- [Data terms of use](https://www.naturalearthdata.com/about/terms-of-use/)

## Local file

The repository includes [`clickstudio/web/public/geo/countries-50m.geojson`](public/geo/countries-50m.geojson), which the app serves locally.

GeoJSON is a JSON format for geographic data. This file keeps each country's English name and shape, with coordinates rounded to four decimal places.
