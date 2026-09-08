# NBTS Blood AI — local Docker helpers
# Prefer: make up   |   make up-llm   |   make config

.PHONY: up up-llm down config logs pull-phi4 deploy-railway

up:
	./scripts/up.sh

up-llm:
	WITH_LLM=1 ./scripts/up.sh

down:
	docker compose --profile llm down

config:
	docker compose --profile llm config

logs:
	docker compose logs -f --tail=200

# Pull phi4 into the Compose ollama service (stack must be up with --profile llm).
pull-phi4:
	docker compose --profile llm exec ollama ollama pull phi4

deploy-railway:
	./scripts/deploy-railway.sh
