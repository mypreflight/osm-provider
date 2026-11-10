Feature: Pulling airport infrastructure from OpenStreetMap
  As the Flight Tracker backend
  I want one airport's infrastructure in the common format
  So that an operator can review it before it is written to the airport model

  Scenario: A complete airport comes back as one reviewable payload
    Given OpenStreetMap holds a complete airport
    When I request the airport "LIPZ"
    Then the response status should be 200
    And the response body should contain:
      """
      {
        "airport": {
          "icaoCode": "LIPZ",
          "name": "Venice Marco Polo",
          "source": "OpenStreetMap via Overpass",
          "location": "@any",
          "shape": "@any",
          "runways": "@any",
          "terminals": "@any",
          "parkingPositions": "@any",
          "gates": "@any"
        }
      }
      """

  Scenario: The ICAO code is normalised before it reaches Overpass
    Given OpenStreetMap holds a complete airport
    When I request the airport "lipz"
    Then the response status should be 200
    And the response body should have the property "airport.icaoCode"
    And Overpass should have been queried 1 time
    And Overpass should have been asked for the enclosed area

  Scenario: One OpenStreetMap runway becomes a record per landing direction
    Given OpenStreetMap holds an aerodrome with the runway "04R/22L"
    When I request the airport "LIPZ" including "runways"
    Then the response status should be 200
    And the response body should contain:
      """
      {
        "airport": {
          "icaoCode": "LIPZ",
          "name": "Venice Marco Polo",
          "source": "OpenStreetMap via Overpass",
          "runways": [
            {
              "designator": "04R",
              "length": 3300,
              "width": 45,
              "magneticHeading": 40,
              "trueHeading": "@any",
              "elevation": 2,
              "surfaceType": "asphalt",
              "lightingType": "unknown",
              "coordinates": "@any"
            },
            {
              "designator": "22L",
              "length": 3300,
              "width": 45,
              "magneticHeading": 220,
              "trueHeading": "@any",
              "elevation": 2,
              "surfaceType": "asphalt",
              "lightingType": "unknown",
              "coordinates": "@any"
            }
          ]
        }
      }
      """

  Scenario: A stand carries neutral baselines for everything OpenStreetMap cannot supply
    Given OpenStreetMap holds the stands "1, 2, 3" and the gates "1, 2"
    When I request the airport "LIPZ" including "parkingPositions"
    Then the response status should be 200
    And the response body should contain:
      """
      {
        "airport": {
          "icaoCode": "LIPZ",
          "name": "Venice Marco Polo",
          "source": "OpenStreetMap via Overpass",
          "parkingPositions": [
            {
              "name": "1",
              "terminal": "T1",
              "bridge": "no",
              "stairs": "no",
              "deicing": "no",
              "gpu": "no",
              "pca": "no",
              "type": "straight-in",
              "spotType": "other",
              "assistance": "none",
              "location": "gate",
              "noiseSensitivity": "no",
              "fuelingOptions": "none",
              "coordinates": { "longitude": 12.3476, "latitude": 45.5048 }
            },
            {
              "name": "2",
              "terminal": "T1",
              "bridge": "no",
              "stairs": "no",
              "deicing": "no",
              "gpu": "no",
              "pca": "no",
              "type": "straight-in",
              "spotType": "other",
              "assistance": "none",
              "location": "gate",
              "noiseSensitivity": "no",
              "fuelingOptions": "none",
              "coordinates": { "longitude": 12.3479, "latitude": 45.5048 }
            },
            {
              "name": "3",
              "terminal": "T1",
              "bridge": "no",
              "stairs": "no",
              "deicing": "no",
              "gpu": "no",
              "pca": "no",
              "type": "straight-in",
              "spotType": "other",
              "assistance": "none",
              "location": "remote",
              "noiseSensitivity": "no",
              "fuelingOptions": "none",
              "coordinates": { "longitude": 12.3482, "latitude": 45.5048 }
            }
          ]
        }
      }
      """

  Scenario: Each gate links to the stand it boards onto, by name
    Given OpenStreetMap holds the stands "1, 2, 3" and the gates "1, 2"
    When I request the airport "LIPZ" including "gates"
    Then the response status should be 200
    And the response body should contain:
      """
      {
        "airport": {
          "icaoCode": "LIPZ",
          "name": "Venice Marco Polo",
          "source": "OpenStreetMap via Overpass",
          "gates": [
            {
              "name": "1",
              "category": "international",
              "terminal": "T1",
              "parkingPosition": "1",
              "coordinates": { "longitude": 12.34765, "latitude": 45.50473 }
            },
            {
              "name": "2",
              "category": "international",
              "terminal": "T1",
              "parkingPosition": "2",
              "coordinates": { "longitude": 12.34795, "latitude": 45.50473 }
            }
          ]
        }
      }
      """

  Scenario: include narrows the payload without dropping the airport's identity
    Given OpenStreetMap holds a complete airport
    When I request the airport "LIPZ" including "runways"
    Then the response status should be 200
    And the response body should have the property "airport.icaoCode"
    And the response body should have the property "airport.runways"
    And the response body should not have the property "airport.gates"
    And the response body should not have the property "airport.shape"

  Scenario: An aerodrome mapped as a bare node is searched by radius instead
    Given OpenStreetMap maps the aerodrome as a bare node, with its features nearby
    When I request the airport "LIPZ"
    Then the response status should be 200
    And Overpass should have been asked for the enclosed area
    And Overpass should have been asked for a radius around the aerodrome
    And the response body should have the property "airport.runways.0.designator"
    And the response body should not have the property "airport.shape"
