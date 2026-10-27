from markupsafe import soft_unicode


def render(value):
    return soft_unicode(value)
