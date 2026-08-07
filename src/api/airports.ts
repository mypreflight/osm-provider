import { createClient } from './client.ts';
import type {
  CreateGateRequest,
  CreateParkingPositionRequest,
  CreateRunwayRequest,
  CreateTerminalRequest,
  GetAirportResponse,
  GetGateResponse,
  GetParkingPositionResponse,
  GetRunwayResponse,
  GetTerminalResponse,
  UpdateAirportRequest,
} from '../airport/airport.types.ts';

const BASE = '/api/v1/airport';

export function airportsApi(token: string) {
  const { request } = createClient(token);

  return {
    list: () => request<GetAirportResponse[]>('GET', BASE),
    patch: (id: string, body: UpdateAirportRequest) =>
      request<GetAirportResponse>('PATCH', `${BASE}/${id}`, body),

    listRunways: (airportId: string) =>
      request<GetRunwayResponse[]>('GET', `${BASE}/${airportId}/runway`),
    createRunway: (airportId: string, body: CreateRunwayRequest) =>
      request<GetRunwayResponse>('POST', `${BASE}/${airportId}/runway`, body),
    patchRunway: (airportId: string, runwayId: string, body: Partial<CreateRunwayRequest>) =>
      request<GetRunwayResponse>('PATCH', `${BASE}/${airportId}/runway/${runwayId}`, body),

    listTerminals: (airportId: string) =>
      request<GetTerminalResponse[]>('GET', `${BASE}/${airportId}/terminal`),
    createTerminal: (airportId: string, body: CreateTerminalRequest) =>
      request<GetTerminalResponse>('POST', `${BASE}/${airportId}/terminal`, body),
    patchTerminal: (airportId: string, terminalId: string, body: Partial<CreateTerminalRequest>) =>
      request<GetTerminalResponse>('PATCH', `${BASE}/${airportId}/terminal/${terminalId}`, body),

    listParkingPositions: (airportId: string) =>
      request<GetParkingPositionResponse[]>('GET', `${BASE}/${airportId}/parking-position`),
    createParkingPosition: (airportId: string, body: CreateParkingPositionRequest) =>
      request<GetParkingPositionResponse>('POST', `${BASE}/${airportId}/parking-position`, body),
    patchParkingPosition: (
      airportId: string,
      parkingPositionId: string,
      body: Partial<CreateParkingPositionRequest>,
    ) =>
      request<GetParkingPositionResponse>(
        'PATCH',
        `${BASE}/${airportId}/parking-position/${parkingPositionId}`,
        body,
      ),

    listGates: (airportId: string) =>
      request<GetGateResponse[]>('GET', `${BASE}/${airportId}/gate`),
    createGate: (airportId: string, body: CreateGateRequest) =>
      request<GetGateResponse>('POST', `${BASE}/${airportId}/gate`, body),
    patchGate: (airportId: string, gateId: string, body: Partial<CreateGateRequest>) =>
      request<GetGateResponse>('PATCH', `${BASE}/${airportId}/gate/${gateId}`, body),
  };
}
