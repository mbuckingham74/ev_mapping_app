import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import L from 'leaflet';
import type { Station } from '../types';
import { useAppStore } from '../store';
import { getFacilityDisplayName, getChargerSpeedLabel } from '../utils';

// Fix for default marker icons in Leaflet + bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Set up default icon
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Custom icon for EA stations
const eaIcon = new L.Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Center of continental US
const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795];
const DEFAULT_ZOOM = 4;

interface MapProps {
  stations?: Station[];
  onStationClick?: (station: Station) => void;
}

// Component to handle map view updates
function MapController({ center }: { center?: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      map.flyTo(center, 10);
    }
  }, [center, map]);

  return null;
}

export function Map({ stations = [], onStationClick }: MapProps) {
  const selectedStation = useAppStore((state) => state.selectedStation);
  const currentLocation = useAppStore((state) => state.currentLocation);

  const mapCenter: [number, number] = currentLocation
    ? [currentLocation.latitude, currentLocation.longitude]
    : DEFAULT_CENTER;

  return (
    <MapContainer
      center={mapCenter}
      zoom={DEFAULT_ZOOM}
      className="h-full w-full"
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapController
        center={
          selectedStation
            ? [selectedStation.latitude, selectedStation.longitude]
            : undefined
        }
      />

      {stations.map((station) => (
        <Marker
          key={station.id}
          position={[station.latitude, station.longitude]}
          icon={eaIcon}
          eventHandlers={{
            click: () => onStationClick?.(station),
          }}
        >
          <Popup>
            <StationPopup station={station} />
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function StationPopup({ station }: { station: Station }) {
  return (
    <div className="min-w-[200px]">
      <h3 className="font-bold text-slate-900 text-sm mb-1">
        {station.station_name}
      </h3>
      <p className="text-slate-600 text-xs mb-2">
        {station.street_address}
        <br />
        {station.city}, {station.state} {station.zip}
      </p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500">Chargers:</span>
          <span className="font-medium text-slate-700">
            {station.ev_dc_fast_num} DC Fast
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Speed:</span>
          <span className="font-medium text-slate-700">
            {getChargerSpeedLabel(station.max_power_kw)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Location:</span>
          <span className="font-medium text-slate-700">
            {getFacilityDisplayName(station.facility_type)}
          </span>
        </div>
      </div>
    </div>
  );
}
