Feature: Rejecting a request before it costs an Overpass query
  As a free public service Overpass has a usage policy
  I want obviously wrong requests refused locally
  So that a typo in the backend never becomes traffic someone else pays for

  Scenario: A request with no ICAO code at all
    When I request no airport at all
    Then the response status should be 400
    And the response body should contain:
      """
      {
        "error": {
          "code": "BAD_REQUEST",
          "message": "@any",
          "status": 400
        }
      }
      """
    And Overpass should have been queried 0 times

  Scenario Outline: An ICAO code that cannot be one
    When I request the airport "<icao>"
    Then the response status should be 400
    And Overpass should have been queried 0 times

    Examples:
      | icao  |
      | LIP   |
      | LIPZX |
      | LI1Z  |
      |       |

  Scenario: An include section this provider does not report on
    When I request the airport "LIPZ" including "runways,taxiways"
    Then the response status should be 400
    And Overpass should have been queried 0 times

  Scenario: A method the endpoint does not answer
    When I request the airport "LIPZ" with the method "delete"
    Then the response status should be 405
    And the response body should contain:
      """
      {
        "error": {
          "code": "METHOD_NOT_ALLOWED",
          "message": "@any",
          "status": 405
        }
      }
      """
    And Overpass should have been queried 0 times

  Scenario: A request without the function secret
    When I request the airport "LIPZ" without the function secret
    Then the response status should be 401
    And the response body should contain:
      """
      {
        "error": {
          "code": "UNAUTHORIZED",
          "message": "The Authorization header is missing or wrong.",
          "status": 401
        }
      }
      """
    And Overpass should have been queried 0 times

  Scenario: A request with the wrong function secret
    When I request the airport "LIPZ" with the bearer token "not-the-secret"
    Then the response status should be 401
    And Overpass should have been queried 0 times
