// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
//check that mapbox gl js is loaded 
console.log("Mapbox GL JS Loaded:", mapboxgl);
// Set your Mapbox access token here
mapboxgl.accessToken = 'YOURMAPBOXACCESSTOKEN';

const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRAFFIC_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
let departuresByMinute = Array.from({length : 1440}, () => []); 
let arrivalsByMinute = Array.from({length : 1440}, () => []);



// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.11336156646188, 42.371811003803586], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

const svg = d3.select('#map').select("svg");
const stationFlow = d3.scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', {timeStyle: 'short'});

}
function minutesSinceMidnight(date){
  return date.getHours() * 60 + date.getMinutes();

}
function filterByMinute(tripsByMinute, minute){
  if (minute === -1){
    return tripsByMinute.flat();
  }
  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;
  if (minMinute > maxMinute){
    return tripsByMinute.slice(minMinute).flat().concat(tripsByMinute.slice(0, maxMinute).flat());
  }
  return tripsByMinute.slice(minMinute, maxMinute).flat();
}

function getStationId(station) {
  return station.short_name || station.Number;
}

function getCoords(station) {
  const lon = Number(station.lon ?? station.Long);
  const lat = Number(station.lat ?? station.Lat);
  const point = new mapboxgl.LngLat(lon, lat);
  const {x, y} = map.project(point);
  return {cx: x, cy: y};
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    v => v.length,
    d => d.start_station_id
  );
  const arrivals = d3.rollup( 
    filterByMinute(arrivalsByMinute, timeFilter),
    v => v.length,
    d => d.end_station_id
  );
  return stations.map(station => {
    const id = getStationId(station);
    return {
      ...station,
      departures: departures.get(id) ?? 0,
      arrivals: arrivals.get(id) ?? 0,
      totalTraffic: (departures.get(id) ?? 0) + (arrivals.get(id) ?? 0),
    };
  }
  );
} 

map.on('load', async () => {
  map.addSource('boston-routes', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  const bikeLanePaint = {
    'line-color': '#32D400',
    'line-width': 4,
    'line-opacity': 0.6,
  };
  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line', 
    source: 'boston-routes',
    paint: bikeLanePaint,
  });
  map.addSource('cambridge-routes', {
    type: 'geojson',
    data: 'https://data.cambridgema.gov/resource/2w9d-6w8k.geojson',
  });
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge-routes',
    paint: bikeLanePaint,
  });
  const stationsJSON = await d3.json(STATIONS_URL);
  const baseStations = stationsJSON.data.stations;
  await d3.csv(TRAFFIC_URL, trip => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);
    departuresByMinute[startedMinutes].push(trip);
    arrivalsByMinute[endedMinutes].push(trip);
    return trip;
  });
  let stations = computeStationTraffic(baseStations);
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 25]);
  const circles = svg
    .selectAll('circle')
    .data(stations, d => getStationId(d))
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .style('--departure-ratio', d => {
      if (d.totalTraffic === 0) return 0.5;
      return stationFlow(d.departures / d.totalTraffic);
    })
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`)
        
    });
    function updatePositions() {
      circles 
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy);
    }
    function updateToolTips() {
      circles.select('title')
        .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    }
    function updateScatterPLot(timeFilter) {
      const filteredStations = computeStationTraffic(baseStations, timeFilter);
      radiusScale
        .domain([0, d3.max(filteredStations, d => d.totalTraffic)])
        .range(timeFilter === -1 ? [0,25] : [3, 50]);

      circles
        .data(filteredStations, d => getStationId(d))
        .attr('r', d=> radiusScale(d.totalTraffic))
        .style('--departure-ratio', d => {
          if (d.totalTraffic === 0) return 0.5;
          return stationFlow(d.departures / d.totalTraffic);
        });

      updateToolTips();
      updatePositions();
    }
    updatePositions();
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time'); 
    const anyTimeLabel = document.getElementById('any-time');

    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value);
      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }
      updateScatterPLot(timeFilter);
    }
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();


  }
  
  
);


