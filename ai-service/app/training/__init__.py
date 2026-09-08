"""Training package exports."""

__all__ = ["train_models"]


def __getattr__(name: str):
    if name == "train_models":
        from app.training.service import train_models

        return train_models
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
