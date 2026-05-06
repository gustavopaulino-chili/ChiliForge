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

$email = trim($data["email"]);
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
    // Verificar se email já existe
    $stmt = $conn->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $stmt->store_result();

    if ($stmt->num_rows > 0) {
        http_response_code(409);
        echo json_encode(["error" => "Email already registered"]);
        $stmt->close();
        $conn->close();
        exit;
    }
    $stmt->close();

    // Resolve account type from domain allowlist when configured.
    $hashedPwd = password_hash($pwd, PASSWORD_DEFAULT);
    $resolved = resolve_account_type_by_domain($email, 'testing');
    $accountType = $resolved['accountType'];
    $stmt = $conn->prepare("INSERT INTO users (email, pwd, account_type) VALUES (?, ?, ?)");
    $stmt->bind_param("sss", $email, $hashedPwd, $accountType);

    if ($stmt->execute()) {
        echo json_encode([
            "success" => true,
            "id" => $conn->insert_id,
            "email" => $email,
            "name" => $email,
            "accountType" => $accountType
        ]);
    } else {
        http_response_code(500);
        echo json_encode(["error" => "Failed to create account: " . $conn->error]);
    }

    $stmt->close();
    $conn->close();
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["error" => "Database connection error"]);
}
?>
