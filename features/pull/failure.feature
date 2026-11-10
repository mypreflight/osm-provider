Feature: Failing usefully
  As the Flight Tracker backend
  I want a status code that says whose problem it is
  So that a failed data upgrade can be retried, reported, or fixed in OpenStreetMap

  Scenario: An ICAO code OpenStreetMap does not know is the caller's problem
    Given OpenStreetMap holds nothing
    When I request the airport "LIPZ"
    Then the response status should be 404
    And the response body should contain:
      """
      {
        "error": {
          "code": "AERODROME_NOT_FOUND",
          "message": "@any",
          "status": 404
        }
      }
      """

  Scenario: Overpass being down is reported as an upstream failure, after a retry
    Given Overpass is unavailable
    When I request the airport "LIPZ"
    Then the response status should be 502
    And the response body should contain:
      """
      {
        "error": {
          "code": "OVERPASS_UNAVAILABLE",
          "message": "@any",
          "status": 502
        }
      }
      """
    And Overpass should have been queried 2 times

  Scenario: An unparseable answer is treated the same as no answer
    Given Overpass answers with something that is not JSON
    When I request the airport "LIPZ"
    Then the response status should be 502
    And the response body should have the property "error.code"
    And Overpass should have been queried 2 times
