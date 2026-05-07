<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data["email"]) || !isset($data["pwd"])) {
    http_response_code(400);
    echo json_encode(["error" => "Email and password are required"]);
    exit;
}

$email = strtolower(trim($data["email"]));
$pwd = $data["pwd"];

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid email"]);
    exit;
}

if (strlen($pwd) < 6) {
    http_response_code(400);
    echo json_encode(["error" => "Password must be at least 6 characters"]);
    exit;
}

include "db.php";
include "accountType.php";

try {
    // Use prepared statement to avoid SQL injection and do not depend on a name column.
    $stmt = $conn->prepare("SELECT id, email, pwd, account_type FROM users WHERE email = ?");
    if (!$stmt) {
        throw new Exception($conn->error ?: 'Prepare failed');
    }

    $stmt->bind_param("s", $email);
    if (!$stmt->execute()) {
        throw new Exception($stmt->error ?: 'Execute failed');
    }

    $stmt->store_result();

    if ($stmt->num_rows === 0) {
        http_response_code(401);
        echo json_encode(["error" => "User not found"]);
        $stmt->close();
        $conn->close();
        exit;
    }

    $stmt->bind_result($userId, $userEmail, $userPwdHash, $accountType);
    $stmt->fetch();
    $stmt->close();

    if (is_string($userPwdHash) && password_verify($pwd, $userPwdHash)) {
        $storedAccountType = normalize_account_type($accountType);
        $resolved = resolve_account_type_by_domain($userEmail, $storedAccountType);
        $effectiveAccountType = normalize_account_type($resolved['accountType']);

        // Keep DB value aligned with allowlist-derived result when allowlist is active.
        if ($resolved['configured'] && $effectiveAccountType !== $storedAccountType) {
            $updateStmt = $conn->prepare("UPDATE users SET account_type = ? WHERE id = ?");
            if ($updateStmt) {
                $updateStmt->bind_param("si", $effectiveAccountType, $userId);
                $updateStmt->execute();
                $updateStmt->close();
            }
        }

        echo json_encode([
            "id" => $userId,
            "email" => $userEmail,
            "name" => $userEmail,
            "accountType" => $effectiveAccountType
        ]);
    } else {
        http_response_code(401);
        echo json_encode(["error" => "Invalid password"]);
    }

    $conn->close();
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        "error" => "Server error",
        "details" => $e->getMessage()
    ]);
}
?>
