#!/bin/bash
# Run integration tests with isolated AutoMem instance
#
# Usage:
#   ./run-tests.sh          # Run unit tests only
#   ./run-tests.sh --all    # Run unit + integration tests
#   ./run-tests.sh --int    # Run integration tests only

set -e

cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_step() {
    echo -e "${GREEN}▶${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

echo_error() {
    echo -e "${RED}✖${NC} $1"
}

# Parse arguments
RUN_UNIT=true
RUN_INTEGRATION=false

case "${1:-}" in
    --all)
        RUN_INTEGRATION=true
        ;;
    --int|--integration)
        RUN_UNIT=false
        RUN_INTEGRATION=true
        ;;
    --help|-h)
        echo "Usage: $0 [--all|--int]"
        echo ""
        echo "  (no args)     Run unit tests only"
        echo "  --all         Run unit + integration tests"
        echo "  --int         Run integration tests only"
        exit 0
        ;;
esac

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo_step "Installing dependencies..."
    npm install
fi

# Run unit tests
if [ "$RUN_UNIT" = true ]; then
    echo_step "Running unit tests..."
    npm run test
fi

# Run integration tests
if [ "$RUN_INTEGRATION" = true ]; then
    # Resolve AUTOMEM_REPO_PATH
    if [ -z "$AUTOMEM_REPO_PATH" ]; then
        # Default to ~/dotfiles/automem if it exists, otherwise assume ../automem
        if [ -d "$HOME/dotfiles/automem" ]; then
            export AUTOMEM_REPO_PATH="$HOME/dotfiles/automem"
        else
            export AUTOMEM_REPO_PATH="$SCRIPT_DIR/../automem"
        fi
    fi

    if [ ! -d "$AUTOMEM_REPO_PATH" ]; then
        echo_error "AutoMem repository not found at $AUTOMEM_REPO_PATH"
        echo_error "Please set AUTOMEM_REPO_PATH environment variable"
        exit 1
    fi

    echo_step "Using AutoMem repo at: $AUTOMEM_REPO_PATH"
    echo_step "Starting test Docker containers..."
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        echo_error "Docker is required for integration tests"
        exit 1
    fi

    # Check if docker compose is available
    if ! docker compose version &> /dev/null; then
        echo_error "Docker Compose is required for integration tests"
        exit 1
    fi

    # Start test containers
    docker compose -f docker-compose.test.yml up -d --wait

    # Wait for API to be ready
    echo_step "Waiting for AutoMem test instance..."
    MAX_RETRIES=30
    RETRY_COUNT=0
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -sf http://localhost:18001/health > /dev/null 2>&1; then
            echo_step "Test instance ready!"
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        sleep 1
    done

    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo_error "Timeout waiting for test instance"
        docker compose -f docker-compose.test.yml logs
        docker compose -f docker-compose.test.yml down -v
        exit 1
    fi

    # Run integration tests
    echo_step "Running integration tests..."
    npm run test:integration

    # Cleanup
    echo_step "Cleaning up test containers..."
    docker compose -f docker-compose.test.yml down -v
fi

echo_step "All tests completed!"
