# A failure that cannot be repaired by editing production source

The original test directly imports a removed MarkupSafe API. Run `python -m unittest -v` with versions 2.0.1 and 2.1.5. The repair agent is not allowed to change tests or dependency requirements, so a valid source-only repair may not exist. Oriclus must preserve the observed test failure and show any rejected, failed, or unavailable repair instead of claiming success. This is a deliberately constructed negative-control example, not a production repository.
